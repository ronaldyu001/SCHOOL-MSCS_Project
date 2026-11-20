from typing import Protocol


class ContextWindowExceeded(ValueError):
    """The supplied input exceeds the model's available context."""


class LLMPort(Protocol):
    def generate(
        self,
        prompt: str,
        *,
        max_new_tokens: int = 128,
        temperature: float = 0.0,
        seed: int | None = None,
    ) -> str:
        """Complete a formatted prompt, sampling only when temperature is positive."""
        ...


class TokenizerPort(Protocol):
    @property
    def context_window(self) -> int | None:
        """Maximum sequence length, when the checkpoint declares a limit."""
        ...

    def count_tokens(self, text: str) -> int:
        """Count text tokens without adding special tokens."""
        ...

    def prompt_fits(self, prompt: str, *, max_new_tokens: int = 0) -> bool:
        """Check the prompt and output allowance against any known context limit."""
        ...


class ContinuationScorerPort(Protocol):
    def mean_log_probability(self, prompt: str, continuation: str) -> float:
        """Score the supplied continuation tokens conditioned on the prompt."""
        ...
