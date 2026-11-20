from collections.abc import Iterable
from dataclasses import dataclass
from random import Random

from application.use_cases.dataset.index_dataset import render_memory_turn
from domain.entities import Conversation, Session, Turn


@dataclass(frozen=True)
class ConversationTurn:
    session: Session
    turn: Turn

    @property
    def text(self) -> str:
        return render_memory_turn(self.session, self.turn)


def conversation_turns(conversation: Conversation) -> tuple[ConversationTurn, ...]:
    return tuple(
        ConversationTurn(session, turn)
        for session in conversation.sessions
        for turn in session.turns
    )


def sample_turns(
    conversations: Iterable[Conversation], *, seed: int, require_prior: bool = False
) -> list[tuple[str, tuple[ConversationTurn, ...], int]]:
    targets = []
    first_position = 1 if require_prior else 0
    for conversation in sorted(conversations, key=lambda item: item.id):
        turns = conversation_turns(conversation)
        for position in range(first_position, len(turns)):
            targets.append((conversation.id, turns, position))
    Random(seed).shuffle(targets)
    return targets
