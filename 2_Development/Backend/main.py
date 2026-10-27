from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from infrastructure.config import config

from presentation.routes_dataset import router as dataset_router
from presentation.routes_health import router as health_router


app = FastAPI(title=config.api_title)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[config.frontend_url],
    allow_credentials=False,
    allow_methods=config.cors_allow_methods,
    allow_headers=config.cors_allow_headers,
)
app.include_router(health_router)
app.include_router(dataset_router)
