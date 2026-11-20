from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from itertools import islice, zip_longest
from math import isfinite

from application.use_cases.generation import RewriteQuery
from application.use_cases.retrieval import BuildContext, RetrieveMemories
from application.use_cases.rewards import RewardInput, RewardInputSkipped, RewardSkip

from .select_rewrite import select_rewrite


@dataclass(frozen=True)
class TrainingExample:
    prompt: str
    completion: str


@dataclass(frozen=True)
class InputOutcome:
    input_id: str
    candidate_count: int = 0
    skip_reason: str | None = None
    winning_score: float | None = None
    top_ties: int = 0


@dataclass
class RewardDataset:
    examples: list[TrainingExample] = field(default_factory=list)
    outcomes: list[InputOutcome] = field(default_factory=list)

    def summary(self) -> dict:
        return {
            "attempted": len(self.outcomes),
            "kept": len(self.examples),
            "skipped": dict(Counter(
                outcome.skip_reason for outcome in self.outcomes if outcome.skip_reason
            )),
            "tied_winners": sum(outcome.top_ties > 1 for outcome in self.outcomes),
        }


@dataclass(frozen=True)
class RewardBuildSettings:
    seed: int = 123
    candidates: int = 8
    temperature: float = 0.7
    rewrite_max_tokens: int = 48
    top_k: int = 20
    token_budget: int = 512
    max_inputs_per_reward: int | None = None

    def __post_init__(self) -> None:
        if self.candidates < 2:
            raise ValueError("Generate at least two candidates per input.")
        if not isfinite(self.temperature) or self.temperature <= 0:
            raise ValueError("Reward builds require a finite, positive temperature.")
        if min(self.rewrite_max_tokens, self.top_k, self.token_budget) < 1:
            raise ValueError("Rewrite length, retrieval depth, and token budget must be positive.")
        if self.max_inputs_per_reward is not None and self.max_inputs_per_reward < 1:
            raise ValueError("The input limit must be positive.")


class BuildRewardDataset:
    def __init__(
        self,
        rewriter: RewriteQuery,
        retrieval: RetrieveMemories,
        context: BuildContext,
        settings: RewardBuildSettings,
    ) -> None:
        self._rewriter = rewriter
        self._retrieval = retrieval
        self._context = context
        self._settings = settings

    def execute(
        self, inputs: Mapping[str, Iterable[RewardInput | RewardSkip]]
    ) -> dict[str, RewardDataset]:
        datasets = {reward: RewardDataset() for reward in inputs}
        limited = {
            reward: islice(items, self._settings.max_inputs_per_reward)
            for reward, items in inputs.items()
        }
        if "r0" in limited and "r1" in limited:
            for r0, r1 in zip_longest(limited.pop("r0"), limited.pop("r1")):
                group = [
                    (reward, item)
                    for reward, item in (("r0", r0), ("r1", r1))
                    if item is not None
                ]
                self._score_group(group, datasets)
        for reward, items in limited.items():
            for item in items:
                self._score_group([(reward, item)], datasets)
        return datasets

    def _score_group(
        self,
        group: Sequence[tuple[str, RewardInput | RewardSkip]],
        datasets: dict[str, RewardDataset],
    ) -> None:
        # R0 and R1 can share work when they use the same question and retrieval scope.
        grouped: dict[
            tuple[str, str, str, frozenset[str] | None], list[tuple[str, RewardInput]]
        ] = {}
        for reward, item in group:
            if isinstance(item, RewardSkip):
                datasets[reward].outcomes.append(
                    InputOutcome(item.input_id, skip_reason=item.reason)
                )
                continue
            key = (item.input_id, item.conversation_id, item.rewrite_input, item.eligible_turn_ids)
            grouped.setdefault(key, []).append((reward, item))
        for matching in grouped.values():
            self._score_candidates(matching, datasets)

    def _score_candidates(
        self, group: Sequence[tuple[str, RewardInput]], datasets: dict[str, RewardDataset]
    ) -> None:
        source = group[0][1]
        settings = self._settings
        rewrites = self._rewriter.execute(
            source.rewrite_input,
            input_id=f"{source.conversation_id}:{source.input_id}",
            seed=settings.seed,
            count=settings.candidates,
            temperature=settings.temperature,
            max_new_tokens=settings.rewrite_max_tokens,
        )
        count = len(rewrites.queries)
        if count < 2:
            for reward, item in group:
                datasets[reward].outcomes.append(
                    InputOutcome(item.input_id, count, "too_few_distinct_rewrites")
                )
            return
        ranked = self._retrieval.execute(
            rewrites.queries,
            conversation_id=source.conversation_id,
            top_k=settings.top_k,
            eligible_turn_ids=source.eligible_turn_ids,
        )
        contexts = [self._context.execute(matches, settings.token_budget) for matches in ranked]
        for reward, item in group:
            dataset = datasets[reward]
            try:
                scores = [item.score(context) for context in contexts]
            except RewardInputSkipped as error:
                dataset.outcomes.append(InputOutcome(item.input_id, count, error.reason))
                continue
            winner = select_rewrite(scores)
            if winner is None:
                dataset.outcomes.append(InputOutcome(item.input_id, count, "all_scores_tied"))
                continue
            index, score = winner
            dataset.examples.append(TrainingExample(rewrites.prompt, rewrites.queries[index]))
            dataset.outcomes.append(InputOutcome(
                item.input_id, count, winning_score=score, top_ties=scores.count(score)
            ))
