from collections.abc import Callable
from dataclasses import dataclass
from hashlib import sha256

from application.ports.models import LLMPort


REWRITE_PROMPT_VERSION = "3"
_REWRITE_TEMPLATE = """Rewrite the input as one standalone search query for conversation memories.

Keep the intent and all details that affect the answer, including names, timing, and relationships.
Resolve references using the input. For dialogue alone, query the event or fact earlier memories could clarify.
Use precise search terms grounded in the input. Output only the query on one line.

Input:
Sam: I just bought tickets for the jazz festival.
Lee: Which show did you pick?
Query: Which show at the jazz festival did Sam buy tickets for?

Input:
Did Gina finish her fashion-styling video before she opened her store?
Query: Which came first, Gina finishing her fashion-styling video or Gina opening her store?

Input:
{text}
Query:"""


@dataclass(frozen=True)
class RewriteCandidates:
    prompt: str
    queries: tuple[str, ...]


class RewriteQuery:
    def __init__(self, model: LLMPort) -> None:
        self._model = model

    def execute(
        self,
        text: str,
        *,
        input_id: str,
        seed: int,
        count: int,
        temperature: float,
        max_new_tokens: int,
        check_cancelled: Callable[[], None] | None = None,
    ) -> RewriteCandidates:
        prompt = _REWRITE_TEMPLATE.format(text=text.strip())
        unique: dict[str, str] = {}
        for index in range(count):
            if check_cancelled is not None:
                check_cancelled()
            seed_bytes = sha256(f"{seed}:{input_id}:{index}".encode()).digest()
            candidate_seed = int.from_bytes(seed_bytes[:8], "big") >> 1
            generated = self._model.generate(
                prompt,
                max_new_tokens=max_new_tokens,
                temperature=temperature,
                seed=candidate_seed,
            ).strip()
            if generated:
                query = " ".join(generated.splitlines()[0].split())
                unique.setdefault(query.casefold(), query)
        return RewriteCandidates(prompt, tuple(unique.values()))
