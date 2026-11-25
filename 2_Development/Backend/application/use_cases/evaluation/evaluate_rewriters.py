from collections import Counter
from collections.abc import Callable, Iterable
from contextlib import AbstractContextManager, nullcontext
from dataclasses import dataclass

from application.ports.models import LLMPort
from application.use_cases.dataset.index_dataset import render_memory_turn
from application.use_cases.generation import RewriteQuery
from application.use_cases.retrieval.score_evidence import normalize_evidence_ids
from application.use_cases.retrieval.search_memories import SearchMemories
from domain.entities import DatasetPartition, QA

from .benchmark import BenchmarkConfig

VARIANTS = ("raw", "prompted", "r1", "r2", "r3", "r0")
DIAGNOSTIC = "gold_query"


@dataclass(frozen=True)
class EvalQuestion:
    question: QA
    evidence: tuple[str, ...]
    gold_query: str


def evaluation_questions(partition: DatasetPartition) -> tuple[list[EvalQuestion], dict]:
    turns = {
        conversation.id: {
            turn.id: render_memory_turn(session, turn)
            for session in conversation.sessions for turn in session.turns
        }
        for conversation in partition.conversations
    }
    questions = []
    excluded: dict[str, Counter] = {}
    for item in partition.qa:
        evidence = normalize_evidence_ids(item.evidence_turn_ids)
        available = turns[item.conversation_id]
        if not item.question.strip():
            reason = "blank_question"
        elif not evidence:
            reason = "missing_evidence"
        elif not all(source in available for source in evidence):
            reason = "unresolved_evidence"
        else:
            questions.append(EvalQuestion(item, evidence, " ".join(available[source] for source in evidence)))
            continue
        excluded.setdefault(item.category, Counter())[reason] += 1
    if not questions:
        raise ValueError("There are no eligible questions in the evaluation partition.")
    return questions, {category: dict(counts) for category, counts in excluded.items()}


class EvaluateRewriters:
    def __init__(
        self,
        search: SearchMemories,
        load_rewriter: Callable[[str | None], AbstractContextManager[LLMPort]],
    ) -> None:
        self._search = search
        self._load_rewriter = load_rewriter

    def execute(
        self,
        questions: list[EvalQuestion],
        benchmark: BenchmarkConfig,
        adapters: dict[int, dict[str, str]],
        report_progress: Callable[[dict], None],
    ) -> Iterable[dict]:
        # Baselines are deterministic and get searched once per question. Their
        # rows are paired with each seed for comparable aggregation.
        total = len(questions) * (3 + sum(map(len, adapters.values())))
        done = 0

        def variant_rows(variant: str, run_id: str | None, seeds: tuple[int, ...]):
            nonlocal done
            report_progress({"phase": "scoring", "variant": variant, "seeds": seeds,
                             "completed": done, "total": total})
            model_context = nullcontext() if variant in {"raw", DIAGNOSTIC} else self._load_rewriter(run_id)
            with model_context as model:
                rewrite = RewriteQuery(model) if model is not None else None
                for item in questions:
                    qa = item.question
                    query = item.gold_query if variant == DIAGNOSTIC else qa.question
                    blank_rewrite = False
                    if rewrite is not None:
                        candidates = rewrite.execute(
                            qa.question, input_id=qa.id, seed=seeds[0], count=1,
                            temperature=0.0, max_new_tokens=benchmark.build["rewrite_max_tokens"],
                        ).queries
                        blank_rewrite = not candidates
                        if candidates:
                            query = candidates[0]
                    result = self._search.execute(
                        (query,), conversation_id=qa.conversation_id, top_k=benchmark.top_k,
                        token_budgets=benchmark.token_budgets, expected_turn_ids=item.evidence, select=False,
                    ).queries[0]
                    for budget_result in result.budgets:
                        packed = budget_result.context
                        first_hit = next((
                            rank for rank, match in enumerate(packed.included_matches, 1)
                            if set(item.evidence).intersection(match.memory.source_turn_ids)
                        ), None)
                        for seed in seeds:
                            yield {
                                "seed": seed, "variant": variant, "question_id": qa.id,
                                "conversation_id": qa.conversation_id, "category": qa.category,
                                "query": query, "blank_rewrite": blank_rewrite,
                                "gold_turn_ids": item.evidence,
                                "matched_turn_ids": sorted(set(item.evidence) & packed.source_turn_ids),
                                "budget": budget_result.token_budget,
                                "recall": budget_result.evidence_recall,
                                "first_hit_rank": first_hit, "tokens_used": packed.tokens_used,
                            }
                    done += 1
                    # Bound manifest writes for a long evaluation.
                    if done % 8 == 0 or done == total:
                        report_progress({"phase": "scoring", "variant": variant, "seeds": seeds,
                                         "completed": done, "total": total})

        for variant in ("raw", "prompted", DIAGNOSTIC):
            yield from variant_rows(variant, None, tuple(adapters))
        for seed, runs in adapters.items():
            for variant in VARIANTS[2:]:
                if variant in runs:
                    yield from variant_rows(variant, runs[variant], (seed,))
