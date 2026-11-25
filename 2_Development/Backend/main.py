from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from application.use_cases.generation import GenerateText
from infrastructure.config import config
from infrastructure.dataset.workspace_store import DatasetWorkspaceStore
from presentation.dataset_workspace import restore_index_ownership
from infrastructure.training.artifact_store import FileArtifactStore
from infrastructure.training.worker import SubprocessTrainingWorker

from presentation.resources import ModelCache
from presentation.routes_dataset import router as dataset_router
from presentation.routes_evaluation import router as evaluation_router
from presentation.routes_health import router as health_router
from presentation.routes_model import router as model_router
from presentation.routes_retrieval import router as retrieval_router
from presentation.routes_rewards import router as rewards_router
from presentation.routes_system import router as system_router
from presentation.routes_training import router as training_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    store = app.state.artifact_store
    with store.transaction():
        store.recover_interrupted()
    app.state.dataset_workspace_store.restore(app.state)
    restore_index_ownership(app.state)
    try:
        yield
    finally:
        app.state.training_worker.close()


app = FastAPI(title=config.api_title, lifespan=lifespan)
app.state.artifact_store = FileArtifactStore(config.artifacts_dir)
app.state.dataset_workspace_store = DatasetWorkspaceStore(config.artifacts_dir)
app.state.training_worker = SubprocessTrainingWorker(app.state.artifact_store)

# One checkpoint in memory, shared by generation, rewriting, answering,
# tokenization and continuation scoring. GenerateText loads through the same
# cache, so its model and the harness's are the same object.
app.state.model_cache = ModelCache()
app.state.generate_text = GenerateText(app.state.model_cache.get)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[config.frontend_url],
    allow_credentials=False,
    allow_methods=config.cors_allow_methods,
    allow_headers=config.cors_allow_headers,
    expose_headers=["Content-Disposition", "Location"],
)
app.include_router(health_router)
app.include_router(dataset_router)
app.include_router(system_router)
app.include_router(model_router)
app.include_router(retrieval_router)
app.include_router(rewards_router)
app.include_router(training_router)
app.include_router(evaluation_router)
