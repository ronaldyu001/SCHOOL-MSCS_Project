from collections.abc import Sequence
from dataclasses import dataclass

from application.ports.memory_store import MemoryMatch
from application.use_cases.training.select_rewrite import RewriteSelection, SelectRewrite

from .build_context import BuildContext, BuiltContext
from .retrieve_memories import RetrieveMemories
from .score_evidence import normalize_evidence_ids, score_evidence


@dataclass(frozen=True)
class BudgetResult:
    token_budget: int
    context: BuiltContext
    evidence_recall: float | None


@dataclass(frozen=True)
class QueryResult:
    query: str
    matches: tuple[MemoryMatch, ...]
    first_expected_rank: int | None
    budgets: tuple[BudgetResult, ...]


@dataclass(frozen=True)
class SearchResult:
    expected: frozenset[str]
    queries: tuple[QueryResult, ...]
    selection: RewriteSelection | None


class SearchMemories:
    def __init__(self, retrieve: RetrieveMemories, build_context: BuildContext) -> None:
        self._retrieve = retrieve
        self._build_context = build_context

    def execute(
        self,
        queries: Sequence[str],
        *,
        conversation_id: str,
        top_k: int,
        token_budgets: Sequence[int],
        expected_turn_ids: Sequence[str] = (),
        eligible_turn_ids: frozenset[str] | None = None,
    ) -> SearchResult:
        budgets = sorted(set(token_budgets))
        if not budgets:
            raise ValueError("Provide at least one token budget.")
        expected = frozenset(normalize_evidence_ids(expected_turn_ids))
        ranked = self._retrieve.execute(
            queries, conversation_id=conversation_id, top_k=top_k,
            eligible_turn_ids=eligible_turn_ids,
        )
        results = []
        for query, matches in zip(queries, ranked, strict=True):
            first_expected = next(
                (rank for rank, match in enumerate(matches, 1)
                 if expected.intersection(match.memory.source_turn_ids)),
                None,
            )
            packed_results = []
            for budget in budgets:
                context = self._build_context.execute(matches, budget)
                recall = score_evidence(expected, context.source_turn_ids) if expected else None
                packed_results.append(BudgetResult(budget, context, recall))
            results.append(QueryResult(query, matches, first_expected, tuple(packed_results)))

        selection = None
        if expected:
            selection = SelectRewrite().execute(
                [result.budgets[-1].evidence_recall or 0.0 for result in results]
            )
        return SearchResult(expected, tuple(results), selection)
