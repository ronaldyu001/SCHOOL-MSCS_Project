import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from application.use_cases.generation import GenerateText
from infrastructure.config import config


router = APIRouter(prefix="/model", tags=["model"])
logger = logging.getLogger(__name__)


class GenerateRequest(BaseModel):
    prompt: str = Field(pattern=r"\S")
    model_id: str | None = Field(
        default=None,
        max_length=193,
        pattern=r"^[a-zA-Z0-9_][a-zA-Z0-9_.-]*/[a-zA-Z0-9_][a-zA-Z0-9_.-]*$",
        description="Hugging Face Hub model ID in owner/model format. Omit to use the default.",
    )
    revision: str | None = Field(default=None, pattern=r"\S")
    max_new_tokens: int = Field(default=128, gt=0, strict=True)
    temperature: float = Field(default=0.0, ge=0, allow_inf_nan=False)


class GenerateResponse(BaseModel):
    text: str


@router.post("/generate")
def generate_text(body: GenerateRequest, request: Request) -> GenerateResponse:
    """Complete a text prompt using the requested or configured model."""
    model_id = body.model_id or config.llm_model_id
    revision = body.revision
    if revision is None and model_id == config.llm_model_id:
        revision = config.llm_model_revision

    # Transformers also accepts local directories with the same shape as Hub IDs.
    if Path(model_id).is_dir():
        raise HTTPException(status_code=422, detail="Provide a Hugging Face Hub model ID.")

    generate: GenerateText = request.app.state.generate_text
    try:
        text = generate.execute(
            body.prompt,
            model_id=model_id,
            revision=revision,
            max_new_tokens=body.max_new_tokens,
            temperature=body.temperature,
        )
    except Exception as error:
        logger.exception("Generation failed for model %s", model_id)
        raise HTTPException(
            status_code=503, detail="Model generation failed. Check backend logs and retry."
        ) from error
    return GenerateResponse(text=text)
