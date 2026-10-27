from typing import Sequence

from infrastructure.config import Config, config


class BGEAdapter:
    """Frozen BGE encoder; query instructions never enter document embeddings."""

    def __init__(self, settings: Config = config) -> None:
        if settings.embedding_batch_size <= 0:
            raise ValueError("Embedding batch size must be positive.")
        if not 1 <= settings.embedding_max_length <= 512:
            raise ValueError("BGE maximum input length must be between 1 and 512 tokens.")

        # Keep model dependencies and downloads out of ordinary API startup.
        from sentence_transformers import SentenceTransformer

        self.settings = settings
        self.model = SentenceTransformer(
            settings.embedding_model,
            revision=settings.embedding_revision,
            device=settings.embedding_device,
            trust_remote_code=False,
        )
        self.model.max_seq_length = settings.embedding_max_length
        self.model.eval()
        self.model.requires_grad_(False)
        dimension = self.model.get_sentence_embedding_dimension()
        if dimension is None:
            raise ValueError("Embedding model does not declare its vector size.")
        self._vector_size = dimension

    @property
    def vector_size(self) -> int:
        return self._vector_size

    def embed_documents(self, texts: Sequence[str]) -> Sequence[Sequence[float]]:
        return self._encode(texts, prompt="")

    def embed_queries(self, texts: Sequence[str]) -> Sequence[Sequence[float]]:
        return self._encode(texts, prompt=self.settings.embedding_query_instruction)

    def _encode(self, texts: Sequence[str], prompt: str) -> Sequence[Sequence[float]]:
        if not texts:
            return []
        return self.model.encode(
            list(texts),
            prompt=prompt,
            batch_size=self.settings.embedding_batch_size,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        ).tolist()
