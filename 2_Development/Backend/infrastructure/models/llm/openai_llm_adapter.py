import json
from time import sleep
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from application.ports.models import ContextWindowExceeded

class OpenAIRewriteError(RuntimeError):
    """An upstream failure that can be shown without exposing request data."""


class OpenAILLMAdapter:
    model_id = "gpt-6-luna"

    def __init__(self, api_key: str) -> None:
        self._api_key = api_key

    def generate(
        self,
        prompt: str,
        *,
        max_new_tokens: int = 128,
        temperature: float = 0.0,
        seed: int | None = None,
    ) -> str:
        # Preserve the build seed for local work. OpenAI's sampling seed is deprecated.
        request = Request(
            "https://api.openai.com/v1/chat/completions",
            data=json.dumps({
                "model": self.model_id,
                "messages": [{"role": "user", "content": prompt}],
                "reasoning_effort": "none",
                "max_completion_tokens": max_new_tokens,
                "temperature": temperature,
                "store": False,
            }).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
        )
        for attempt in range(3):
            try:
                with urlopen(request, timeout=60) as response:
                    payload = json.load(response)
                message = payload["choices"][0]["message"]
                content = message.get("content")
                if isinstance(content, str):
                    return content
                if message.get("refusal"):
                    return ""
                raise OpenAIRewriteError("GPT-6 Luna returned no rewrite text.")
            except HTTPError as error:
                status = error.code
                with error:
                    if status == 400:
                        try:
                            code = json.load(error)["error"]["code"]
                        except (ValueError, KeyError, TypeError):
                            code = None
                        if code == "context_length_exceeded":
                            raise ContextWindowExceeded(
                                "The request exceeded the GPT-6 Luna context window."
                            ) from None
                if status not in {429, 500, 502, 503, 504} or attempt == 2:
                    raise OpenAIRewriteError(
                        f"GPT-6 Luna request failed (HTTP {status}). Check API access and quota."
                    ) from None
            except (TimeoutError, URLError):
                if attempt == 2:
                    raise OpenAIRewriteError("Could not reach GPT-6 Luna. Check the backend connection.") from None
            except (ValueError, KeyError, IndexError, TypeError, AttributeError):
                raise OpenAIRewriteError("GPT-6 Luna returned an invalid response.") from None
            sleep(2**attempt)
        raise OpenAIRewriteError("GPT-6 Luna request failed.")
