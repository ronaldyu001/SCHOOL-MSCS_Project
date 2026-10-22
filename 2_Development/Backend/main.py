from fastapi import FastAPI

from presentation.routes_health import router as health_router

app = FastAPI(title="Memory Rewriter API")
app.include_router(health_router)
