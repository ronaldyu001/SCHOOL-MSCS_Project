from collections.abc import Callable, Sequence
from math import isfinite
from pathlib import Path

from application.use_cases.training.build_reward_dataset import TrainingExample
from application.use_cases.training.training_run import TrainingSettings

from .checkpoint import resolve_hub_revision
from .runtime import describe_runtime


class TransformersLoRATrainerAdapter:
    def train(
        self,
        examples: Sequence[TrainingExample],
        *,
        model_id: str,
        revision: str | None,
        device: str,
        settings: TrainingSettings,
        output: Path,
        report_progress: Callable[[dict], None],
    ) -> tuple[str, dict]:
        import torch
        from datasets import Dataset
        from peft import LoraConfig
        from transformers import AutoConfig, AutoModelForCausalLM, AutoTokenizer, TrainerCallback, set_seed
        from trl import SFTConfig, SFTTrainer

        if device == "cuda" and not torch.cuda.is_available():
            raise ValueError("CUDA is unavailable. Start the backend with GPU access or use CPU.")
        if device == "mps" and not torch.backends.mps.is_available():
            raise ValueError("MPS is unavailable. Run the backend natively on a supported Mac or use CPU.")
        use_bf16 = device == "cuda" and torch.cuda.is_bf16_supported()
        runtime = describe_runtime(device, mixed_precision="bfloat16" if use_bf16 else "none")
        if device == "cuda":
            torch.cuda.reset_peak_memory_stats()
        set_seed(settings.seed)
        report_progress({"phase": "loading_model", "runtime": runtime})
        commit = resolve_hub_revision(model_id, revision)
        checkpoint = AutoConfig.from_pretrained(model_id, revision=commit, trust_remote_code=False)
        tokenizer = AutoTokenizer.from_pretrained(model_id, revision=commit, trust_remote_code=False)
        if tokenizer.eos_token_id is None:
            raise ValueError("The checkpoint tokenizer must provide an end-of-sequence token.")
        if tokenizer.pad_token_id is None:
            tokenizer.pad_token = tokenizer.eos_token
        tokenizer.padding_side = "right"

        context_length = min(
            settings.max_length,
            getattr(checkpoint, "max_position_embeddings", None) or settings.max_length,
            tokenizer.model_max_length,
        )
        rows = []
        for example in examples:
            # Match inference's prompt tokens exactly, including any BOS. Encode
            # the continuation independently so a BPE merge cannot move the boundary.
            prompt = tokenizer.encode(example.prompt)
            answer = tokenizer.encode(" " + example.completion, add_special_tokens=False)
            if not prompt or not answer:
                continue
            if answer[-1] != tokenizer.eos_token_id:
                answer.append(tokenizer.eos_token_id)
            if len(prompt) + len(answer) <= context_length:
                rows.append({
                    "input_ids": prompt + answer,
                    "labels": [-100] * len(prompt) + answer,
                })
        if not rows:
            raise ValueError("No complete prompt/rewrite pairs fit the training token limit.")

        model = AutoModelForCausalLM.from_pretrained(
            model_id, revision=commit, trust_remote_code=False, dtype=torch.float32,
        )
        model.config.use_cache = False

        class ReportSteps(TrainerCallback):
            def on_log(self, args, state, control, logs=None, **kwargs) -> None:
                loss = (logs or {}).get("loss")
                progress = {
                    "phase": "training", "step": state.global_step, "total_steps": state.max_steps,
                    "epoch": state.epoch,
                }
                if loss is not None and isfinite(loss):
                    progress["loss"] = loss
                report_progress(progress)

        trainer = SFTTrainer(
            model=model,
            processing_class=tokenizer,
            train_dataset=Dataset.from_list(rows),
            peft_config=LoraConfig(
                task_type="CAUSAL_LM", target_modules="all-linear", revision=commit,
                r=settings.lora_rank, lora_alpha=settings.lora_alpha, bias="none",
            ),
            args=SFTConfig(
                output_dir=str(output.parent / "checkpoints"),
                completion_only_loss=True,
                dataset_kwargs={"skip_prepare_dataset": True},
                max_length=context_length,
                use_cpu=device == "cpu",
                bf16=use_bf16,
                gradient_checkpointing=False,
                learning_rate=settings.learning_rate,
                num_train_epochs=settings.epochs,
                per_device_train_batch_size=settings.batch_size,
                gradient_accumulation_steps=settings.gradient_accumulation_steps,
                seed=settings.seed,
                data_seed=settings.seed,
                logging_steps=1,
                logging_nan_inf_filter=False,
                save_strategy="no",
                disable_tqdm=True,
                report_to=[],
            ),
            callbacks=[ReportSteps()],
        )
        if trainer.args.device.type != device:
            raise ValueError(f"Trainer selected {trainer.args.device.type} instead of {device}. Check LLM_DEVICE.")
        result = trainer.train()
        if not isfinite(result.training_loss):
            raise ValueError("Training produced a non-finite loss. Lower the learning rate and retry.")
        report_progress({"phase": "saving_adapter", "step": result.global_step})
        trainer.model.save_pretrained(output, safe_serialization=True)
        return commit, {
            **{key: value for key, value in result.metrics.items() if isfinite(value)},
            **({"peak_device_memory_bytes": torch.cuda.max_memory_reserved()} if device == "cuda" else {}),
            "steps": result.global_step,
            "examples_used": len(rows),
            "examples_skipped": len(examples) - len(rows),
            "max_length": context_length,
        }
