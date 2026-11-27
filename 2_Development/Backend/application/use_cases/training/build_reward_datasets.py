from collections.abc import Callable, Sequence

from application.ports.memory_store import MemoryStorePort
from application.ports.models import ContinuationScorerPort, EmbeddingPort, LLMPort, TokenizerPort
from application.use_cases.generation import AnswerQuestion, RewriteQuery
from application.use_cases.retrieval import BuildContext, RetrieveMemories
from application.use_cases.rewards import R0Builder, R1Builder, R2Builder, R3Builder, TrainingQuestion
from domain.entities import DatasetPartition

from .build_reward_dataset import BuildRewardDataset, RewardBuildSettings, RewardDataset


REWARD_IDS = ("r0", "r1", "r2", "r3")
REWARD_PIPELINE_VERSION = 2


class BuildRewardDatasets:
    """Build selected reward datasets from one training partition."""

    def __init__(
        self,
        model: LLMPort,
        tokenizer: TokenizerPort,
        scorer: ContinuationScorerPort,
        embedder: EmbeddingPort,
        store: MemoryStorePort,
    ) -> None:
        self._model = model
        self._tokenizer = tokenizer
        self._scorer = scorer
        self._embedder = embedder
        self._store = store

    def execute(
        self,
        train: DatasetPartition,
        rewards: Sequence[str],
        settings: RewardBuildSettings,
        *,
        answer_max_tokens: int = 64,
        r2_prior_turns: int = 3,
        r3_max_tokens: int = 64,
        rewrite_model: LLMPort | None = None,
        r1_teacher_model: LLMPort | None = None,
        report_progress: Callable[[str, int], None] | None = None,
        check_cancelled: Callable[[], None] | None = None,
    ) -> dict[str, RewardDataset]:
        self.validate_inputs(train, rewards)

        def interruptible[**P, T](operation: Callable[P, T]) -> Callable[P, T]:
            if check_cancelled is None:
                return operation

            def run(*args: P.args, **kwargs: P.kwargs) -> T:
                check_cancelled()
                return operation(*args, **kwargs)

            return run

        inputs = {}
        for reward in REWARD_IDS:
            if reward not in rewards:
                continue
            if reward == "r0":
                inputs[reward] = R0Builder().execute(train.conversations, train.qa)
            elif reward == "r1":
                reader = AnswerQuestion(self._model, self._tokenizer, answer_max_tokens)
                teacher = (
                    interruptible(AnswerQuestion(r1_teacher_model, None, answer_max_tokens).execute)
                    if r1_teacher_model is not None else None
                )
                questions = (
                    TrainingQuestion(qa.id, qa.conversation_id, qa.question) for qa in train.qa
                )
                inputs[reward] = R1Builder(
                    interruptible(reader.execute), reader.fits, teacher=teacher
                ).execute(
                    train.conversations, questions
                )
            elif reward == "r2":
                inputs[reward] = R2Builder(
                    interruptible(self._scorer.mean_log_probability), prior_turns=r2_prior_turns
                ).execute(train.conversations, seed=settings.seed)
            elif reward == "r3":
                inputs[reward] = R3Builder(
                    interruptible(lambda prompt: self._model.generate(prompt, max_new_tokens=r3_max_tokens))
                ).execute(train.conversations, seed=settings.seed)

        return BuildRewardDataset(
            RewriteQuery(self._model if rewrite_model is None else rewrite_model),
            RetrieveMemories(self._embedder, self._store),
            BuildContext(self._tokenizer.count_tokens),
            settings,
            check_cancelled=check_cancelled,
        ).execute(inputs, report_progress=report_progress)

    @staticmethod
    def validate_inputs(train: DatasetPartition, rewards: Sequence[str]) -> None:
        unknown = sorted(set(rewards) - set(REWARD_IDS))
        if unknown:
            raise ValueError(f"Unknown rewards: {', '.join(unknown)}.")
        if not rewards:
            raise ValueError("Select at least one reward.")
        if not train.conversations:
            raise ValueError("The training partition holds no conversations.")
        needs_questions = sorted({"r0", "r1"}.intersection(rewards))
        if needs_questions and not train.qa:
            raise ValueError(
                f"{', '.join(needs_questions).upper()} needs training questions. "
                "Widen the category filter or select only R2 and R3."
            )
