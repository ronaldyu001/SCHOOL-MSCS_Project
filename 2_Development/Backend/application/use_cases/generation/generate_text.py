from collections.abc import Callable
from threading import Lock

from application.ports.models import LLMPort


class GenerateText:
    """Reuse the most recently requested model within this process."""

    def __init__(self, load_model: Callable[[str, str | None], LLMPort]) -> None:
        self._load_model = load_model
        self._lock = Lock()
        self._loaded: tuple[tuple[str, str | None], LLMPort] | None = None

    def execute(
        self,
        prompt: str,
        *,
        model_id: str,
        revision: str | None = None,
        max_new_tokens: int = 128,
        temperature: float = 0.0,
    ) -> str:
        key = (model_id, revision)
        # A switch waits for in-flight generation and releases the old model first.
        with self._lock:
            if self._loaded is None or self._loaded[0] != key:
                self._loaded = None
                self._loaded = (key, self._load_model(model_id, revision))
            _, model = self._loaded
            return model.generate(
                prompt, max_new_tokens=max_new_tokens, temperature=temperature
            )
