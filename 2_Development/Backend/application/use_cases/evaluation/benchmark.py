from dataclasses import dataclass
from typing import Literal

from domain.entities import DatasetSplit, QACategory

from application.use_cases.training.build_reward_dataset import RewardBuildSettings
from application.use_cases.training.training_run import TrainingSettings

from . import EvaluationMode


@dataclass(frozen=True)
class BenchmarkConfig:
    version: str
    corpus_sha256: str
    split: DatasetSplit
    split_seed: int
    seeds: tuple[int, ...]
    categories: tuple[QACategory, ...]
    model_id: str
    model_revision: str
    embedding: dict
    reward_pipeline_version: int
    rewrite_prompt_version: str
    top_k: int
    token_budgets: tuple[int, ...]
    build: dict
    training: dict
    hardware: dict

    @classmethod
    def from_dict(cls, data: dict) -> "BenchmarkConfig":
        return cls(
            **{
                **data,
                "split": DatasetSplit(**{name: tuple(ids) for name, ids in data["split"].items()}),
                "seeds": tuple(data["seeds"]),
                "categories": tuple(data["categories"]),
                "token_budgets": tuple(data["token_budgets"]),
            }
        )

    def __post_init__(self) -> None:
        if len(self.seeds) < 2 or len(set(self.seeds)) != len(self.seeds):
            raise ValueError("The benchmark needs at least two distinct seeds.")
        for seed in self.seeds:
            self.training_settings(seed)
        self.reward_settings(self.seeds[0])
        if self.top_k < 1 or tuple(sorted(set(self.token_budgets))) != self.token_budgets or (
            not self.token_budgets or self.token_budgets[0] < 1
        ):
            raise ValueError("Benchmark budgets must be distinct, positive and ascending.")
        if not all((self.split.train_conversation_ids, self.split.validation_conversation_ids,
                    self.split.test_conversation_ids)):
            raise ValueError("The benchmark requires nonempty training, validation and test partitions.")

    def reward_settings(self, seed: int, limit: int | None = None) -> RewardBuildSettings:
        settings = {key: value for key, value in self.build.items() if key not in {
            "answer_max_tokens", "r2_prior_turns", "r3_max_tokens",
        }}
        if limit is not None:
            settings["max_inputs_per_reward"] = limit
        return RewardBuildSettings(seed=seed, **settings)

    def training_settings(self, seed: int) -> TrainingSettings:
        return TrainingSettings(seed=seed, **self.training)

    def split_for(self, mode: EvaluationMode) -> Literal["validation", "test"]:
        return "validation" if mode == "pilot" else "test"
