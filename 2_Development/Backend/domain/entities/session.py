from dataclasses import dataclass
from datetime import datetime
from typing import Tuple

from .turn import Turn


@dataclass(frozen=True)
class Session:
    id: int
    timestamp: datetime
    turns: Tuple[Turn, ...]
