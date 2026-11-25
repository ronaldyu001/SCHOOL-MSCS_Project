from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated, BinaryIO
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, StringConstraints
from starlette.background import BackgroundTask

from application.use_cases.training.manage_artifacts import (
    DeleteArtifact, DownloadArtifact, ReadArtifacts, UpdateArtifact,
)
from application.use_cases.training.training_run import (
    ArtifactConflict, ArtifactKind, ArtifactNotFound,
)


ArtifactName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
ArtifactNotes = Annotated[str, StringConstraints(max_length=4000)]


class ArtifactMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: ArtifactName | None = None
    notes: ArtifactNotes | None = None


@contextmanager
def artifact_errors() -> Iterator[None]:
    try:
        yield
    except ArtifactNotFound as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ArtifactConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


def _chunks(bundle: BinaryIO) -> Iterator[bytes]:
    with bundle:
        while chunk := bundle.read(64 * 1024):
            yield chunk


def artifact_router(path: str, kind: ArtifactKind) -> APIRouter:
    router = APIRouter(prefix=path)

    @router.get("", name=f"list_{kind}")
    def list_artifacts(request: Request) -> list[dict]:
        return ReadArtifacts(request.app.state.artifact_store).execute(kind)

    @router.get("/{artifact_id}", name=f"get_{kind}")
    def get_artifact(artifact_id: UUID, request: Request) -> dict:
        with artifact_errors():
            return ReadArtifacts(request.app.state.artifact_store).execute(kind, str(artifact_id))

    @router.patch("/{artifact_id}", name=f"update_{kind}")
    def update_artifact(artifact_id: UUID, body: ArtifactMetadata, request: Request) -> dict:
        changes = body.model_dump(exclude_none=True)
        with artifact_errors():
            return UpdateArtifact(request.app.state.artifact_store).execute(
                kind, str(artifact_id), changes,
            )

    @router.delete("/{artifact_id}", status_code=204, name=f"delete_{kind}")
    def delete_artifact(artifact_id: UUID, request: Request) -> Response:
        with artifact_errors():
            DeleteArtifact(request.app.state.artifact_store).execute(kind, str(artifact_id))
        return Response(status_code=204)

    @router.get("/{artifact_id}/download", name=f"download_{kind}")
    def download_artifact(artifact_id: UUID, request: Request) -> StreamingResponse:
        with artifact_errors():
            bundle = DownloadArtifact(request.app.state.artifact_store).execute(kind, str(artifact_id))
        prefix = {"datasets": "reward-dataset", "runs": "rewrite-adapter", "evaluations": "evaluation"}[kind]
        return StreamingResponse(
            _chunks(bundle),
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{prefix}-{artifact_id}.zip"'},
            background=BackgroundTask(bundle.close),
        )

    return router
