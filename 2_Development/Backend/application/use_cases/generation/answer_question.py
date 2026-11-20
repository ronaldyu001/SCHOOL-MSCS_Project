from application.ports.models import LLMPort, TokenizerPort


_ANSWER_TEMPLATE = """Answer the question in one line using the conversation below. If the conversation does not support an answer, write INSUFFICIENT_CONTEXT.

Conversation:
{context}

Question: {question}
Answer:"""


class AnswerQuestion:
    def __init__(
        self,
        model: LLMPort,
        tokenizer: TokenizerPort,
        max_new_tokens: int = 64,
    ) -> None:
        self._model = model
        self._tokenizer = tokenizer
        self._max_new_tokens = max_new_tokens

    def fits(self, question: str, context: str) -> bool:
        prompt = _ANSWER_TEMPLATE.format(question=question, context=context)
        return self._tokenizer.prompt_fits(prompt, max_new_tokens=self._max_new_tokens)

    def execute(self, question: str, context: str) -> str:
        prompt = _ANSWER_TEMPLATE.format(question=question, context=context)
        answer = self._model.generate(
            prompt, max_new_tokens=self._max_new_tokens, temperature=0.0
        ).strip()
        return answer.split("\n", 1)[0].strip()
