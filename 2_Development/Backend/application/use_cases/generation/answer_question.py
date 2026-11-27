from dataclasses import dataclass
import re

from application.ports.models import LLMPort, TokenizerPort


_ANSWER_TEMPLATE = """Answer the question in one line using the conversation below. If the conversation does not support an answer, write INSUFFICIENT_CONTEXT.

Conversation:
{context}

Question: {question}
Answer:"""


def answer_abstained(answer: str) -> bool:
    words = " ".join(re.findall(r"[^\W_]+", answer.strip().casefold()))
    return words in {"", "insufficient context", "i don t know", "i do not know"}


class AnswerQuestion:
    def __init__(
        self,
        model: LLMPort,
        tokenizer: TokenizerPort | None,
        max_new_tokens: int = 64,
    ) -> None:
        self._model = model
        self._tokenizer = tokenizer
        self._max_new_tokens = max_new_tokens

    def fits(self, question: str, context: str) -> bool:
        if self._tokenizer is None:
            return True
        prompt = _ANSWER_TEMPLATE.format(question=question, context=context)
        return self._tokenizer.prompt_fits(prompt, max_new_tokens=self._max_new_tokens)

    def execute(self, question: str, context: str) -> str:
        prompt = _ANSWER_TEMPLATE.format(question=question, context=context)
        answer = self._model.generate(
            prompt, max_new_tokens=self._max_new_tokens, temperature=0.0
        ).strip()
        return answer.split("\n", 1)[0].strip()


@dataclass(frozen=True)
class ContextAnswer:
    answer: str | None
    fits: bool
    skip_reason: str | None
    abstained: bool
    context_tokens: int
    context_window: int | None


class AnswerFromContext:
    def __init__(self, reader: AnswerQuestion, tokenizer: TokenizerPort) -> None:
        self._reader = reader
        self._tokenizer = tokenizer

    def execute(self, question: str, context: str) -> ContextAnswer:
        count = self._tokenizer.count_tokens(context)
        window = self._tokenizer.context_window
        if not context.strip():
            return ContextAnswer(None, True, "empty_context", False, count, window)
        if not self._reader.fits(question, context):
            return ContextAnswer(None, False, "context_too_long", False, count, window)
        answer = self._reader.execute(question, context)
        return ContextAnswer(answer, True, None, answer_abstained(answer), count, window)
