from dataclasses import dataclass

import psutil


@dataclass(frozen=True)
class MemorySnapshot:
    total_bytes: int
    available_bytes: int


def get_memory() -> MemorySnapshot:
    memory = psutil.virtual_memory()
    return MemorySnapshot(total_bytes=memory.total, available_bytes=memory.available)
