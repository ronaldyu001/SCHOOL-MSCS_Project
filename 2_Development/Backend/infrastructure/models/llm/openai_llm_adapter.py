import json
from collections.abc import Callable
from math import isfinite
from random import uniform
from threading import Lock
from time import monotonic, sleep
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from application.ports.models import ContextWindowExceeded


class OpenAIRewriteError(RuntimeError):
    """An upstream failure that can be shown without exposing request data."""


class OpenAILLMAdapter:
    model_id = "gpt-6-luna"

    def __init__(
        self,
        api_key: str,
        *,
        requests_per_minute: int = 600,
        check_cancelled: Callable[[], None] | None = None,
    ) -> None:
        if requests_per_minute < 1:
            raise ValueError("OpenAI request rate must be positive.")
        self._api_key = api_key
        self._request_interval = 60 / requests_per_minute
        self._request_lock = Lock()
        self._next_request_at = 0.0
        self._check_cancelled = check_cancelled

    def _pace_request(self) -> None:
        while True:
            if self._check_cancelled is not None:
                self._check_cancelled()
            with self._request_lock:
                now = monotonic()
                delay = self._next_request_at - now
                if delay <= 0:
                    self._next_request_at = now + self._request_interval
                    return
            sleep(min(delay, 0.25))

    def _defer_requests(self, delay: float) -> None:
        with self._request_lock:
            self._next_request_at = max(self._next_request_at, monotonic() + delay)

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
            self._pace_request()
            delay = 2**attempt + uniform(0, 0.25)
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
                code = None
                retry_after = 0.0
                with error:
                    if status in {400, 429}:
                        try:
                            code = json.load(error)["error"]["code"]
                        except (ValueError, KeyError, TypeError):
                            pass
                        if code == "context_length_exceeded":
                            raise ContextWindowExceeded(
                                "The request exceeded the GPT-6 Luna context window."
                            ) from None
                    try:
                        retry_after = float(error.headers.get("Retry-After", 0)) if error.headers else 0.0
                    except (TypeError, ValueError):
                        pass
                if code in {"insufficient_quota", "billing_hard_limit_reached"}:
                    raise OpenAIRewriteError("GPT-6 Luna API quota exhausted. Check OpenAI billing.") from None
                if status not in {429, 500, 502, 503, 504} or attempt == 2:
                    raise OpenAIRewriteError(
                        f"GPT-6 Luna request failed (HTTP {status}). Check API access and quota."
                    ) from None
                if isfinite(retry_after) and retry_after > 60:
                    raise OpenAIRewriteError(
                        f"GPT-6 Luna requested a {retry_after:g}s cooldown (HTTP {status}). Retry the build later."
                    ) from None
                if status == 429 or (isfinite(retry_after) and retry_after > 0):
                    delay = max(delay, retry_after + uniform(0, 0.25)) if isfinite(retry_after) else delay
                    self._defer_requests(delay)
                    continue
            except (TimeoutError, URLError):
                if attempt == 2:
                    raise OpenAIRewriteError("Could not reach GPT-6 Luna. Check the backend connection.") from None
            except (ValueError, KeyError, IndexError, TypeError, AttributeError):
                raise OpenAIRewriteError("GPT-6 Luna returned an invalid response.") from None
            sleep(delay)
        raise OpenAIRewriteError("GPT-6 Luna request failed.")
