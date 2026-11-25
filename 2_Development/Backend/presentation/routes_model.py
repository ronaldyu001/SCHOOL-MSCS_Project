import logging
from dataclasses import asdict

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from application.ports.models.llm import MAX_MODEL_ID_LENGTH, MODEL_ID_PATTERN
from application.use_cases.generation import AnswerQuestion, GenerateText, RewriteQuery
from application.use_cases.generation.answer_question import AnswerFromContext
from application.use_cases.generation.measure_tokens import MeasureTokens
from application.use_cases.generation.rewrite_query import REWRITE_PROMPT_VERSION
from infrastructure.config import config
from infrastructure.models.llm.runtime import resolve_device

from .resources import language_model, resolve_checkpoint


router = APIRouter(prefix="/model", tags=["model"])
logger = logging.getLogger(__name__)


class CheckpointRequest(BaseModel):
    """Fields every route that needs the language model accepts."""

    # `model_id` is ours, not Pydantic's: opt out of its `model_` namespace guard.
    model_config = ConfigDict(protected_namespaces=())

    model_id: str | None = Field(
        default=None,
        max_length=MAX_MODEL_ID_LENGTH,
        pattern=MODEL_ID_PATTERN,
        description="Hugging Face Hub model ID in owner/model format. Omit to use the default.",
    )
    revision: str | None = Field(default=None, pattern=r"\S")


class GenerateRequest(CheckpointRequest):
    prompt: str = Field(pattern=r"\S")
    max_new_tokens: int = Field(default=128, gt=0, le=2048, strict=True)
    temperature: float = Field(default=0.0, ge=0, le=5, allow_inf_nan=False)
    seed: int | None = Field(default=None, description="Only used when temperature is positive.")


class GenerateResponse(BaseModel):
    text: str


class ModelInfoResponse(BaseModel):
    """The frozen harness, as the backend is actually configured.

    Reported without loading anything: the frontend states the configuration on
    arrival, and `loaded_model_id` says whether a checkpoint is already resident
    so the first generation's delay is not a surprise.
    """

    default_model_id: str
    default_revision: str
    loaded_model_id: str | None
    loaded_revision: str | None
    context_window: int | None
    llm_device: str
    embedding_model: str
    embedding_revision: str
    embedding_device: str
    embedding_max_length: int
    embedding_query_instruction: str
    qdrant_collection: str
    index_batch_size: int
    dataset_split_seed: int
    rewrite_prompt_version: str


class TokenCountRequest(CheckpointRequest):
    text: str = Field(min_length=1, max_length=400_000)
    max_new_tokens: int = Field(
        default=0,
        ge=0,
        le=4096,
        strict=True,
        description="Output allowance to reserve when checking the context window.",
    )


class TokenCountResponse(BaseModel):
    token_count: int
    context_window: int | None
    max_new_tokens: int
    fits: bool
    characters: int


class RewriteRequest(CheckpointRequest):
    text: str = Field(pattern=r"\S", max_length=20_000)
    input_id: str = Field(
        default="probe",
        min_length=1,
        max_length=200,
        description="Mixed into each candidate's seed, so a rerun reproduces the set.",
    )
    seed: int = 123
    count: int = Field(default=8, ge=1, le=32, strict=True)
    temperature: float = Field(default=0.7, ge=0, le=5, allow_inf_nan=False)
    max_new_tokens: int = Field(default=48, gt=0, le=512, strict=True)


class RewriteResponse(BaseModel):
    prompt: str
    prompt_version: str
    queries: list[str]
    requested: int
    model_id: str
    revision: str | None


class AnswerRequest(CheckpointRequest):
    question: str = Field(pattern=r"\S", max_length=20_000)
    context: str = Field(default="", max_length=400_000)
    max_new_tokens: int = Field(default=64, gt=0, le=512, strict=True)


class AnswerResponse(BaseModel):
    """The reader's answer, or the reason it could not be asked.

    R1 treats a prompt that overruns the context window as an ineligible input
    rather than a wrong answer, so this route reports the same distinction
    instead of failing the request.
    """

    answer: str | None
    fits: bool
    skip_reason: str | None
    abstained: bool
    context_tokens: int
    context_window: int | None


@router.get("/info")
def model_info(request: Request) -> ModelInfoResponse:
    """Report the configured harness without loading any weights."""
    model_id, revision, context_window = request.app.state.model_cache.info()
    return ModelInfoResponse(
        default_model_id=config.llm_model_id,
        default_revision=config.llm_model_revision,
        loaded_model_id=model_id,
        loaded_revision=revision,
        context_window=context_window,
        llm_device=resolve_device(),
        embedding_model=config.embedding_model,
        embedding_revision=config.embedding_revision,
        embedding_device=config.embedding_device,
        embedding_max_length=config.embedding_max_length,
        embedding_query_instruction=config.embedding_query_instruction,
        qdrant_collection=config.qdrant_collection,
        index_batch_size=config.index_batch_size,
        dataset_split_seed=config.dataset_split_seed,
        rewrite_prompt_version=REWRITE_PROMPT_VERSION,
    )


@router.post("/generate")
def generate_text(body: GenerateRequest, request: Request) -> GenerateResponse:
    """Complete a text prompt using the requested or configured model."""
    model_id, revision = resolve_checkpoint(body.model_id, body.revision)
    generate: GenerateText = request.app.state.generate_text
    try:
        text = generate.execute(
            body.prompt,
            model_id=model_id,
            revision=revision,
            max_new_tokens=body.max_new_tokens,
            temperature=body.temperature,
            seed=body.seed,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        logger.exception("Generation failed for model %s", model_id)
        raise HTTPException(
            status_code=503, detail="Model generation failed. Check backend logs and retry."
        ) from error
    return GenerateResponse(text=text)


@router.post("/tokens")
def count_tokens(body: TokenCountRequest, request: Request) -> TokenCountResponse:
    """Measure text in the reader's tokens, the unit every token budget uses."""
    model = language_model(request, body.model_id, body.revision)
    try:
        result = MeasureTokens(model).execute(body.text, max_new_tokens=body.max_new_tokens)
    except Exception as error:
        logger.exception("Tokenization failed")
        raise HTTPException(
            status_code=503, detail="Tokenization failed. Check backend logs and retry."
        ) from error
    return TokenCountResponse(**asdict(result))


@router.post("/rewrite")
def rewrite_query(body: RewriteRequest, request: Request) -> RewriteResponse:
    """Sample candidate search queries for one input, deduplicated by the use case."""
    model_id, revision = resolve_checkpoint(body.model_id, body.revision)
    model = language_model(request, model_id, revision)
    try:
        candidates = RewriteQuery(model).execute(
            body.text,
            input_id=body.input_id,
            seed=body.seed,
            count=body.count,
            temperature=body.temperature,
            max_new_tokens=body.max_new_tokens,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        logger.exception("Rewriting failed for model %s", model_id)
        raise HTTPException(
            status_code=503, detail="Rewriting failed. Check backend logs and retry."
        ) from error
    return RewriteResponse(
        prompt=candidates.prompt,
        prompt_version=REWRITE_PROMPT_VERSION,
        queries=list(candidates.queries),
        requested=body.count,
        model_id=model_id,
        revision=revision,
    )


@router.post("/answer")
def answer_question(body: AnswerRequest, request: Request) -> AnswerResponse:
    """Answer a question from a packed context, as the R1 reader does."""
    model = language_model(request, body.model_id, body.revision)
    reader = AnswerQuestion(model, model, max_new_tokens=body.max_new_tokens)
    try:
        result = AnswerFromContext(reader, model).execute(body.question, body.context)
    except Exception as error:
        logger.exception("Answering failed")
        raise HTTPException(
            status_code=503, detail="Answering failed. Check backend logs and retry."
        ) from error
    return AnswerResponse(**asdict(result))
