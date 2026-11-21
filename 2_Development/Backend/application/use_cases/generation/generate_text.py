from collections.abc import Callable
from threading import Lock

from application.ports.models import LLMPort


class GenerateText:
    """Generate from a model supplied by the application's model provider."""

    def __init__(self, get_model: Callable[[str, str | None], LLMPort]) -> None:
        self._get_model = get_model
        self._lock = Lock()

    def execute(
        self,
        prompt: str,
        *,
        model_id: str,
        revision: str | None = None,
        max_new_tokens: int = 128,
        temperature: float = 0.0,
        seed: int | None = None,
    ) -> str:
        with self._lock:
            model = self._get_model(model_id, revision)
            return model.generate(
                prompt, max_new_tokens=max_new_tokens, temperature=temperature, seed=seed
            )
