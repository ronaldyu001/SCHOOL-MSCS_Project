from dataclasses import dataclass
from typing import Tuple

from .session import Session


@dataclass(frozen=True)
class Conversation:
    id: str
    speakers: Tuple[str, ...]
    sessions: Tuple[Session, ...]
