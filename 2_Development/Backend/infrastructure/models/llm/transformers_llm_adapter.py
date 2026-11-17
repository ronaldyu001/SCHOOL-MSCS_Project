from math import isfinite
from os import getenv
from pathlib import Path


class TransformersLLMAdapter:
    """Load and run a Transformers-compatible causal language model."""

    def __init__(
        self,
        model_name_or_path: str | Path,
        *,
        revision: str | None = None,
        device: str | None = None,
    ) -> None:
        if device is None:
            device = getenv("LLM_DEVICE", "cpu")
        if device == "gpu":
            device = "cuda"

        if device.split(":", 1)[0] == "cuda":
            from torch.cuda import is_available

            if not is_available():
                raise RuntimeError(
                    "CUDA is unavailable. Run the backend with NVIDIA GPU access "
                    "or select device='cpu'."
                )

        from transformers import AutoModelForCausalLM, AutoTokenizer

        self._tokenizer = AutoTokenizer.from_pretrained(
            model_name_or_path, revision=revision, trust_remote_code=False
        )
        self._model = AutoModelForCausalLM.from_pretrained(
            model_name_or_path, revision=revision, trust_remote_code=False
        ).to(device)
        self._model.eval()

    def generate(
        self, prompt: str, *, max_new_tokens: int = 128, temperature: float = 0.0
    ) -> str:
        if not prompt.strip():
            raise ValueError("Prompt must not be blank.")
        if type(max_new_tokens) is not int or max_new_tokens < 1:
            raise ValueError("Maximum new tokens must be a positive integer.")
        if not isfinite(temperature) or temperature < 0:
            raise ValueError("Temperature must be finite and non-negative.")

        from torch import inference_mode

        inputs = self._tokenizer(prompt, return_tensors="pt").to(self._model.device)
        prompt_length = inputs["input_ids"].shape[-1]
        sample = temperature > 0

        with inference_mode():
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
