from dataclasses import dataclass


@dataclass(frozen=True)
class Turn:
    id: str
    speaker: str
    text: str
