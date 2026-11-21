"""Search the memory store and pack the result into a token budget.

This is the measurement harness the project rests on: the encoder, the memory
format, the retrieval depth and the budget are all fixed, so any difference in
what comes back is attributable to the query text. The route therefore accepts
several queries at once — a raw message alongside its rewrites — and packs each
one at every requested budget, which is what makes a budget curve cheap: one
embedding and one search per query, then a pack per budget.
"""

import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from application.ports.memory_store import MemoryMatch
from application.use_cases.retrieval import BuildContext, RetrieveMemories
from application.use_cases.retrieval.search_memories import SearchMemories
from infrastructure.config import config

from .resources import language_model, memory_resources, require_collection
from .routes_model import MODEL_ID_PATTERN


router = APIRouter(prefix="/retrieval", tags=["retrieval"])
logger = logging.getLogger(__name__)


class SearchRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    conversation_id: str = Field(pattern=r"\S", max_length=200)
    queries: list[str] = Field(min_length=1, max_length=8)
    top_k: int = Field(default=20, gt=0, le=50, strict=True)
    token_budgets: list[int] = Field(default=[512], min_length=1, max_length=6)
    expected_turn_ids: list[str] = Field(
        default_factory=list,
        max_length=200,
        description="Annotated evidence turns. Supply them to score recall and rank.",
    )
    eligible_turn_ids: list[str] | None = Field(
        default=None,
        max_length=2000,
        description="Restrict the search to these source turns, as R2 does.",
    )
    model_id: str | None = Field(default=None, max_length=193, pattern=MODEL_ID_PATTERN)
    revision: str | None = Field(default=None, pattern=r"\S")

    @field_validator("queries")
    @classmethod
    def _queries_not_blank(cls, value: list[str]) -> list[str]:
        if any(not query.strip() for query in value):
            raise ValueError("Queries must not be blank.")
        return value

    @field_validator("token_budgets")
    @classmethod
    def _budgets_positive(cls, value: list[int]) -> list[int]:
        if any(type(budget) is not int or budget < 1 for budget in value):
            raise ValueError("Token budgets must be positive integers.")
        # Ascending and distinct, so the response reads as a curve.
        return sorted(set(value))


class MatchOut(BaseModel):
    rank: int
    memory_id: str
    session_id: int
    source_turn_ids: list[str]
    timestamp: str
    text: str
    score: float
    expected: bool


class BudgetOut(BaseModel):
    token_budget: int
    included_count: int
    tokens_used: int
    context: str
    source_turn_ids: list[str]
    evidence_recall: float | None


class QueryOut(BaseModel):
    index: int
    query: str
    match_count: int
    top_score: float | None
    first_expected_rank: int | None
    matches: list[MatchOut]
    budgets: list[BudgetOut]


class SearchResponse(BaseModel):
    conversation_id: str
    collection: str
    embedding_model: str
    vector_size: int
    context_window: int | None
    top_k: int
    token_budgets: list[int]
    expected_turn_ids: list[str]
    eligible_turn_count: int | None
    results: list[QueryOut]
    selected_index: int | None
    selected_score: float | None
    selection_note: str


def _match_row(rank: int, match: MemoryMatch, expected: frozenset[str]) -> MatchOut:
    return MatchOut(
        rank=rank,
        memory_id=match.memory.id,
        session_id=match.memory.session_id,
        source_turn_ids=list(match.memory.source_turn_ids),
        timestamp=match.memory.timestamp.isoformat(),
        text=match.memory.text,
        score=match.score,
        expected=bool(expected.intersection(match.memory.source_turn_ids)),
    )


@router.post("/search")
def search(body: SearchRequest, request: Request) -> SearchResponse:
    """Embed each query, search one conversation, and pack every budget."""
    eligible = None if body.eligible_turn_ids is None else frozenset(body.eligible_turn_ids)
    try:
        embedder, store = memory_resources(request)
        require_collection(store)
        model = language_model(request, body.model_id, body.revision)
        search_memories = SearchMemories(RetrieveMemories(embedder, store), BuildContext(model.count_tokens))
        outcome = search_memories.execute(
            body.queries,
            conversation_id=body.conversation_id,
            top_k=body.top_k,
            token_budgets=body.token_budgets,
            expected_turn_ids=body.expected_turn_ids,
            eligible_turn_ids=eligible,
        )
    except HTTPException:
        raise
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        logger.exception("Search failed for conversation %s", body.conversation_id)
        raise HTTPException(
            status_code=503,
            detail="Search failed. Check that the memory store is reachable, then retry.",
        ) from error

    results = [
        QueryOut(
            index=index,
            query=result.query,
            match_count=len(result.matches),
            top_score=result.matches[0].score if result.matches else None,
            first_expected_rank=result.first_expected_rank,
            matches=[
                _match_row(rank, match, outcome.expected)
                for rank, match in enumerate(result.matches, 1)
            ],
            budgets=[
                BudgetOut(
                    token_budget=budget.token_budget,
                    included_count=len(budget.context.included_matches),
                    tokens_used=budget.context.tokens_used,
                    context=budget.context.text,
                    source_turn_ids=sorted(budget.context.source_turn_ids),
                    evidence_recall=budget.evidence_recall,
                )
                for budget in result.budgets
            ],
        )
        for index, result in enumerate(outcome.queries)
    ]
    selection = outcome.selection
    selected_index = selection.index if selection else None
    note = "Supply expected_turn_ids to rank the queries."
    if selected_index is not None:
        note = f"Query {selected_index + 1} wins on evidence recall at {body.token_budgets[-1]} tokens"
        tied = selection.tied_winners - 1
        note += f", tied with {tied} other{'s' if tied > 1 else ''}." if tied else "."
    elif selection and selection.reason == "all_scores_tied":
        note = "Every query scored the same, so no rewrite is preferred."
    elif selection:
        note = "One query only: nothing to select between."

    return SearchResponse(
        conversation_id=body.conversation_id,
        collection=store.collection_name,
        embedding_model=config.embedding_model,
        vector_size=embedder.vector_size,
        context_window=model.context_window,
        top_k=body.top_k,
        token_budgets=body.token_budgets,
        expected_turn_ids=sorted(outcome.expected),
        eligible_turn_count=None if eligible is None else len(eligible),
        results=results,
        selected_index=selected_index,
        selected_score=selection.score if selection else None,
        selection_note=note,
    )
