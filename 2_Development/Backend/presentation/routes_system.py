from fastapi import APIRouter

from application.use_cases.system.get_memory import MemorySnapshot, get_memory


router = APIRouter(prefix="/system", tags=["system"])


@router.get("/memory")
def system_memory() -> MemorySnapshot:
    """Report RAM visible to the backend's operating system in bytes."""
    return get_memory()
