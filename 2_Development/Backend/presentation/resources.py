"""Process-wide models and stores shared by the harness routes.

The harness routes all need the same three expensive objects: one language
model, one frozen encoder, and one Qdrant client. Building them per request
would redownload and reload weights; building them per router would hold two
copies of the encoder in one process. They are therefore created on first use
and cached on ``app.state``, which is also where the dataset routes keep the
handles they hand out.

Construction is serialised. A first request that is still downloading weights
must not be joined by a second request that starts its own download.
"""

import logging
from pathlib import Path
from threading import Lock

from fastapi import HTTPException, Request

from infrastructure.config import config
from infrastructure.models.llm import TransformersLLMAdapter

logger = logging.getLogger(__name__)

_model_lock = Lock()
_store_lock = Lock()


class ModelCache:
    """Hold one language model per checkpoint so every route shares a copy.

    Only the most recently requested checkpoint is kept. A switch releases the
    previous model before allocating its replacement, so a second checkpoint
    never has to fit in memory alongside the first.
    """

    def __init__(self) -> None:
        self._loaded: tuple[tuple[str, str | None], TransformersLLMAdapter] | None = None

    @property
    def loaded(self) -> tuple[str, str | None] | None:
        """The checkpoint currently in memory, or None before the first load."""
        loaded = self._loaded
        return loaded[0] if loaded else None

    def info(self) -> tuple[str | None, str | None, int | None]:
        loaded = self._loaded
        if loaded is None:
            return None, None, None
        (model_id, revision), model = loaded
        return model_id, revision, model.context_window

    def get(self, model_id: str, revision: str | None = None) -> TransformersLLMAdapter:
        key = (model_id, revision)
        with _model_lock:
            if self._loaded is None or self._loaded[0] != key:
                self._loaded = None
                self._loaded = (key, TransformersLLMAdapter(model_id, revision=revision))
            return self._loaded[1]


def resolve_checkpoint(model_id: str | None, revision: str | None) -> tuple[str, str | None]:
    """Fill in the configured default, pinning its revision only for that model."""
    resolved_id = model_id or config.llm_model_id
    resolved_revision = revision
    if resolved_revision is None and resolved_id == config.llm_model_id:
        resolved_revision = config.llm_model_revision

    # Transformers also accepts local directories with the same shape as Hub IDs.
    if Path(resolved_id).is_dir():
        raise HTTPException(status_code=422, detail="Provide a Hugging Face Hub model ID.")
    return resolved_id, resolved_revision


def language_model(
    request: Request, model_id: str | None = None, revision: str | None = None
) -> TransformersLLMAdapter:
    """The cached adapter for the requested or configured checkpoint."""
    resolved_id, resolved_revision = resolve_checkpoint(model_id, revision)
    cache: ModelCache = request.app.state.model_cache
    try:
        return cache.get(resolved_id, resolved_revision)
    except Exception as error:
        logger.exception("Loading model %s failed", resolved_id)
        raise HTTPException(
            status_code=503,
            detail=(
                f"Could not load {resolved_id}. Check the model ID and revision, "
                "and the backend logs, then retry."
            ),
        ) from error


def memory_resources(request: Request, *, ensure_collection: bool = False):
    """The shared encoder and memory store, built on first use.

    Pass ``ensure_collection`` from a writer. Readers leave it unset: a search
    against a collection that was never written should report that nothing is
    indexed, not quietly create an empty collection.
    """
    with _store_lock:
        existing = getattr(request.app.state, "memory_resources", None)
        if existing is None:
            from infrastructure.memory_store import QdrantAdapter
            from infrastructure.models.embedding import BGEAdapter

            embedder = BGEAdapter()
            existing = (embedder, QdrantAdapter.from_config(embedder.vector_size))
            request.app.state.memory_resources = existing

        embedder, store = existing
        if ensure_collection and not getattr(request.app.state, "collection_ready", False):
            try:
                store.ensure_collection()
            except Exception:
                # Drop the half-initialised pair so a retry rebuilds it.
                store.client.close()
                request.app.state.memory_resources = None
                raise
            request.app.state.collection_ready = True
        return embedder, store


def require_collection(store) -> None:
    """Fail with an explanation when nothing has been indexed yet."""
    try:
        exists = store.client.collection_exists(store.collection_name)
    except Exception as error:
        logger.exception("Qdrant is unreachable at %s", config.qdrant_url)
        raise HTTPException(
            status_code=503,
            detail=f"Could not reach the memory store at {config.qdrant_url}.",
        ) from error
    if not exists:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Nothing is indexed: collection '{store.collection_name}' does not "
                "exist. Index a prepared partition first."
            ),
        )
