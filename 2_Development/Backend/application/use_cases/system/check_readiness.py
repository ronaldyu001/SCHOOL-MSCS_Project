from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal


@dataclass(frozen=True)
class DependencyStatus:
    name: str
    label: str
    status: Literal["ok", "unavailable"]
    detail: str


@dataclass(frozen=True)
class Readiness:
    ready: bool
    checked_at: str
    dependencies: tuple[DependencyStatus, ...]
    facts: dict


class CheckReadiness:
    def __init__(
        self, probe_store: Callable[[], tuple[DependencyStatus, dict]], api_title: str
    ) -> None:
        self._probe_store = probe_store
        self._api_title = api_title

    def execute(self, *, loaded_model_id: str | None) -> Readiness:
        memory_store, facts = self._probe_store()
        return Readiness(
            ready=memory_store.status == "ok",
            checked_at=datetime.now(timezone.utc).isoformat(),
            dependencies=(
                DependencyStatus("api", "Backend API", "ok", f"{self._api_title} is serving requests."),
                memory_store,
            ),
            facts={
                **facts,
                "reader_model": loaded_model_id,
                "reader_loaded": loaded_model_id is not None,
            },
        )
