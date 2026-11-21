from dataclasses import dataclass

from application.ports.models import TokenizerPort


@dataclass(frozen=True)
class TokenMeasurement:
    token_count: int
    context_window: int | None
    max_new_tokens: int
    fits: bool
    characters: int


class MeasureTokens:
    def __init__(self, tokenizer: TokenizerPort) -> None:
        self._tokenizer = tokenizer

    def execute(self, text: str, *, max_new_tokens: int = 0) -> TokenMeasurement:
        return TokenMeasurement(
            self._tokenizer.count_tokens(text),
            self._tokenizer.context_window,
            max_new_tokens,
            self._tokenizer.prompt_fits(text, max_new_tokens=max_new_tokens),
            len(text),
        )
