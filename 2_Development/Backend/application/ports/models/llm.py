from typing import Protocol


class LLMPort(Protocol):
    def generate(
        self, prompt: str, *, max_new_tokens: int = 128, temperature: float = 0.0
    ) -> str:
        """Complete a formatted prompt, sampling only when temperature is positive."""
        ...
