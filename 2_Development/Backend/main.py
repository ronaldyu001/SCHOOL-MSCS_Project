from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from application.use_cases.generation import GenerateText
from infrastructure.config import config
from infrastructure.models.llm import TransformersLLMAdapter

from presentation.routes_dataset import router as dataset_router
from presentation.routes_health import router as health_router
from presentation.routes_model import router as model_router
from presentation.routes_system import router as system_router


app = FastAPI(title=config.api_title)
app.state.generate_text = GenerateText(
    lambda model_id, revision: TransformersLLMAdapter(model_id, revision=revision)
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[config.frontend_url],
    allow_credentials=False,
    allow_methods=config.cors_allow_methods,
    allow_headers=config.cors_allow_headers,
)
app.include_router(health_router)
app.include_router(dataset_router)
app.include_router(system_router)
app.include_router(model_router)
