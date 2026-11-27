from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from hashlib import sha256

from application.ports.models import LLMPort


REWRITE_PROMPT_VERSION = "3"
_REWRITE_TEMPLATE = """Rewrite the input as one standalone search query for conversation memories.

Keep the intent and all details that affect the answer, including names, timing, and relationships.
Resolve references using the input. For dialogue alone, query the event or fact earlier memories could clarify.
Use only facts from the input. Output only the query on one line.

Input:
Sam: I just bought tickets for the jazz festival.
Lee: Which show did you pick?
Query: Which show at the jazz festival did Sam buy tickets for?

Input:
When Gina has opened her clothing store?
Query: When did Gina open her clothing store?

Input:
{text}
Query:"""


@dataclass(frozen=True)
class RewriteCandidates:
    prompt: str
    queries: tuple[str, ...]


class RewriteQuery:
    def __init__(self, model: LLMPort, max_concurrency: int = 1) -> None:
        self._model = model
        self._max_concurrency = max_concurrency

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

        def generate(index: int) -> str:
            if check_cancelled is not None:
                check_cancelled()
            seed_bytes = sha256(f"{seed}:{input_id}:{index}".encode()).digest()
            candidate_seed = int.from_bytes(seed_bytes[:8], "big") >> 1
            return self._model.generate(
                prompt,
                max_new_tokens=max_new_tokens,
                temperature=temperature,
                seed=candidate_seed,
            ).strip()

        if self._max_concurrency > 1 and count > 1:
            with ThreadPoolExecutor(max_workers=min(self._max_concurrency, count)) as pool:
                pending = [pool.submit(generate, index) for index in range(count)]
                try:
                    # Keep candidate order stable for deduplication and score ties.
                    generated_queries = [task.result() for task in pending]
                finally:
                    for task in pending:
                        task.cancel()
        else:
            generated_queries = map(generate, range(count))

        unique: dict[str, str] = {}
        for generated in generated_queries:
            if generated:
                query = " ".join(generated.splitlines()[0].split())
                unique.setdefault(query.casefold(), query)
        return RewriteCandidates(prompt, tuple(unique.values()))
