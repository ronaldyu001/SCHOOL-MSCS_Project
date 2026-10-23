from dataclasses import dataclass
from typing import Literal, Optional, Tuple


QACategory = Literal[
    "multi_hop",
    "temporal",
    "open_domain",
    "single_hop",
    "adversarial",
]


@dataclass(frozen=True)
class QA:
    id: str
    conversation_id: str
    question: str
    category: QACategory
    answer: Optional[str] = None
    evidence_turn_ids: Tuple[str, ...] = ()
