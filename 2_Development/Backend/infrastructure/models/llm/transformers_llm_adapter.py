from contextlib import contextmanager
from math import isfinite
from pathlib import Path
from threading import Lock

from application.ports.models import ContextWindowExceeded

from .runtime import resolve_device


_sampling_lock = Lock()


@contextmanager
def _sampling_rng(device, *, sample: bool, seed: int | None):
    if not sample:
        yield
        return

    # Transformers samples from PyTorch's default generators. Use the same lock
    # for unseeded calls so they cannot consume an experiment's temporary state.
    with _sampling_lock:
        if seed is None:
            yield
            return

        import torch

        if device.type not in ("cpu", "cuda", "mps"):
            raise ValueError("Seeded sampling requires a CPU, CUDA, or MPS model.")
        cuda_devices = [device.index] if device.type == "cuda" else []
        with torch.random.fork_rng(devices=cuda_devices, device_type="cuda"):
            torch.default_generator.manual_seed(seed)
            if cuda_devices:
                with torch.cuda.device(device):
                    torch.cuda.manual_seed(seed)
            if device.type == "mps":
                state = torch.mps.get_rng_state()
                try:
                    torch.mps.manual_seed(seed)
                    yield
                finally:
                    torch.mps.set_rng_state(state)
            else:
                yield


class TransformersLLMAdapter:
    """Load and run a Transformers-compatible causal language model."""

    def __init__(
        self,
        model_name_or_path: str | Path,
        *,
        revision: str | None = None,
        device: str | None = None,
        adapter_path: Path | None = None,
        dtype: str | None = None,
    ) -> None:
        device = resolve_device(device)

        if device.split(":", 1)[0] == "cuda":
            from torch.cuda import is_available

            if not is_available():
                raise RuntimeError(
                    "CUDA is unavailable. Run the backend with NVIDIA GPU access "
                    "or select device='cpu'."
                )
        if device.split(":", 1)[0] == "mps":
            from torch.backends.mps import is_available

            if not is_available():
                raise RuntimeError("MPS is unavailable. Run the backend natively on a supported Mac or use CPU.")

        from transformers import AutoModelForCausalLM, AutoTokenizer

        from .checkpoint import resolve_hub_revision

        self._resolved_revision = None
        if not Path(model_name_or_path).is_dir():
            revision = resolve_hub_revision(str(model_name_or_path), revision)
            self._resolved_revision = revision
        self._tokenizer = AutoTokenizer.from_pretrained(
            model_name_or_path, revision=revision, trust_remote_code=False
        )
        model = AutoModelForCausalLM.from_pretrained(
            model_name_or_path, revision=revision, trust_remote_code=False, dtype=dtype,
        )
        if adapter_path is not None:
            from peft import PeftModel

            model = PeftModel.from_pretrained(model, adapter_path, is_trainable=False)
        self._model = model.to(device)
        self._model.eval()

    @property
    def resolved_revision(self) -> str | None:
        return self._resolved_revision

    @property
    def device(self) -> str:
        return self._model.device.type

    @property
    def context_window(self) -> int | None:
        model_config = self._model.config
        if hasattr(model_config, "get_text_config"):
            model_config = model_config.get_text_config()
        limits = (
            getattr(self._tokenizer, "model_max_length", None),
            getattr(model_config, "max_position_embeddings", None),
            getattr(model_config, "n_positions", None),
        )
        # Some tokenizers use 1e30 to represent an unspecified maximum.
        return min(
            (size for size in limits if type(size) is int and 0 < size < 10**20),
            default=None,
        )

    def count_tokens(self, text: str) -> int:
        return len(self._tokenizer.encode(text, add_special_tokens=False, verbose=False))

    def prompt_fits(self, prompt: str, *, max_new_tokens: int = 0) -> bool:
        if type(max_new_tokens) is not int or max_new_tokens < 0:
            raise ValueError("Maximum new tokens must be a non-negative integer.")
        limit = self.context_window
        if limit is None:
            return True
        prompt_ids = self._tokenizer.encode(prompt, add_special_tokens=True, verbose=False)
        return len(prompt_ids) + max_new_tokens <= limit

    def generate(
        self,
        prompt: str,
        *,
        max_new_tokens: int = 128,
        temperature: float = 0.0,
        seed: int | None = None,
    ) -> str:
        if not prompt.strip():
            raise ValueError("Prompt must not be blank.")
        if type(max_new_tokens) is not int or max_new_tokens < 1:
            raise ValueError("Maximum new tokens must be a positive integer.")
        if not isfinite(temperature) or temperature < 0:
            raise ValueError("Temperature must be finite and non-negative.")
        if seed is not None and (type(seed) is not int or not -(2**63) <= seed < 2**64):
            raise ValueError("Seed must be an integer in PyTorch's 64-bit seed range.")

        from torch import inference_mode

        inputs = self._tokenizer(prompt, return_tensors="pt").to(self._model.device)
        prompt_length = inputs["input_ids"].shape[-1]
        sample = temperature > 0

        with inference_mode(), _sampling_rng(self._model.device, sample=sample, seed=seed):
            sequences = self._model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                do_sample=sample,
                temperature=temperature if sample else None,
                num_beams=1,
                num_return_sequences=1,
                return_dict_in_generate=False,
            )

        return self._tokenizer.decode(
            sequences[0, prompt_length:], skip_special_tokens=True
        )

    def mean_log_probability(self, prompt: str, continuation: str) -> float:
        if not prompt.strip() or not continuation.strip():
            raise ValueError("Prompt and continuation must not be blank.")

        import torch
        from torch.nn.functional import cross_entropy

        prompt_ids = self._tokenizer.encode(prompt, add_special_tokens=True, verbose=False)
        # Tokenize the target independently so its token IDs are identical under
        # both conditioning prompts, even at the prompt/continuation boundary.
        target_ids = self._tokenizer.encode(
            continuation, add_special_tokens=False, verbose=False
        )
        if not prompt_ids or not target_ids:
            raise ValueError("Prompt and continuation must each encode to at least one token.")
        limit = self.context_window
        if limit is not None and len(prompt_ids) + len(target_ids) > limit:
            raise ContextWindowExceeded(
                f"Prompt and continuation exceed the model's {limit}-token context window."
            )

        with torch.inference_mode():
            # The final prompt token predicts the first target token. Each
            # following position predicts the next target token.
            input_ids = torch.tensor(
                [prompt_ids + target_ids[:-1]], dtype=torch.long, device=self._model.device
            )
            targets = torch.tensor(target_ids, dtype=torch.long, device=self._model.device)
            logits = self._model(input_ids=input_ids, use_cache=False, return_dict=True).logits
            return -cross_entropy(logits[0, -len(target_ids):].float(), targets).item()
