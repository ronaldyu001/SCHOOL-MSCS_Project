"""Model capabilities required by application use cases."""

from .embedding import EmbeddingPort
from .llm import LLMPort

__all__ = ["EmbeddingPort", "LLMPort"]
