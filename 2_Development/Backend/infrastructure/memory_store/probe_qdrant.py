import logging

from qdrant_client import QdrantClient

from application.use_cases.system.check_readiness import DependencyStatus


logger = logging.getLogger(__name__)


def probe_qdrant(url: str, collection: str) -> tuple[DependencyStatus, dict]:
    client = None
    try:
        client = QdrantClient(url=url, timeout=3)
        exists = client.collection_exists(collection)
        count = client.count(collection).count if exists else 0
    except Exception as error:
        logger.warning("Memory store probe failed: %s", error)
        return (
            DependencyStatus(
                "memory_store", "Memory store", "unavailable", f"No answer from the memory store at {url}."
            ),
            {"url": url},
        )
    finally:
        if client is not None:
            client.close()

    detail = (
        f"{count} memories indexed in '{collection}'."
        if count
        else f"Reachable; nothing indexed in '{collection}' yet."
    )
    return DependencyStatus("memory_store", "Memory store", "ok", detail), {
        "url": url,
        "collection": collection,
        "collection_exists": exists,
        "indexed_memories": count,
    }
