from dataclasses import dataclass
from datetime import datetime
from typing import Tuple


@dataclass(frozen=True)
class Memory:
    id: str
    conversation_id: str
    session_id: int
    source_turn_ids: Tuple[str, ...]
    timestamp: datetime
    text: str
