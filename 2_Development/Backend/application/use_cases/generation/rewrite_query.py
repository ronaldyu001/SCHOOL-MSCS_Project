from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from hashlib import sha256

from application.ports.models import LLMPort


REWRITE_PROMPT_VERSION = "3"
EVIDENCE_CANDIDATE_PROMPT_VERSION = "evidence-v5"
EVIDENCE_CANDIDATE_TEMPLATE = """Write one query to retrieve the conversation messages needed to answer the question.
The query will be embedded and ranked by semantic similarity to individual conversation
messages. Phrase it as short, natural statements a speaker might use when talking about
the relevant evidence. Include the speaker's name when the input identifies them.

Keep the known people, events, objects, and relationships that identify the evidence.
Bridge wording gaps with up to two everyday equivalents that express the same fact.
For a comparison, sequence, or shared activity, include a short clause for each side.
Preserve timing, negation, and uncertainty.

Use only facts from the input. Leave the requested answer unstated.
The examples show the format. Use names and details only from the final input.
Output one line of search text with no instructions, explanation, or blanks to fill.

Question: What did Elara do with her colleagues after work?
Query: Elara: I spent time with my coworkers or workmates after work

Question: Did Tavi move to a new apartment before adopting a dog?
Query: Tavi moved into a new apartment. Tavi adopted a dog. Timing of the move and adoption.

Question and dialogue:
{text}

Query:"""

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
    def __init__(
        self,
        model: LLMPort,
        max_concurrency: int = 1,
        *,
        candidate_template: str | None = None,
    ) -> None:
        self._model = model
        self._max_concurrency = max_concurrency
        self._candidate_template = candidate_template

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
        text = text.strip()
        # Train Qwen on the prompt it will receive at inference.
        prompt = _REWRITE_TEMPLATE.format(text=text)
        candidate_prompt = (
            prompt if self._candidate_template is None else self._candidate_template.format(text=text)
        )

        def generate(index: int) -> str:
            if check_cancelled is not None:
                check_cancelled()
            seed_bytes = sha256(f"{seed}:{input_id}:{index}".encode()).digest()
            candidate_seed = int.from_bytes(seed_bytes[:8], "big") >> 1
            return self._model.generate(
                candidate_prompt,
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
