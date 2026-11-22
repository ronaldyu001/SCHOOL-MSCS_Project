# Dataset workflow

The dataset router (`presentation/routes_dataset.py`) exposes four explicit stages. Run the API and open `/docs` to try them.

1. `POST /data/load` with `{"path": "/data/locomo10.json"}` loads a server-local LoCoMo JSON file. It returns a `dataset_id`, conversation IDs, and conversation/QA counts. With Docker Compose, place the file in `2_Development/.data`; that folder is mounted at `/data`.
2. `POST /data/{dataset_id}/splits` with `{"train_size": 6, "validation_size": 2, "test_size": 2, "seed": 123}` creates a split. Sizes must sum to the loaded conversation count. The response contains a `split_id` and each partition's conversation IDs. The same IDs and seed produce the same assignment, regardless of input order.
3. `POST /data/{dataset_id}/prepare` with `{"split_id": "<returned split ID>", "categories": ["single_hop", "multi_hop"]}` validates the dataset and applies the split and optional QA category filter. Omit `categories` to include all categories; an empty list includes no QA. The response returns a `prepared_id`, validation status, and conversation/QA counts for each partition. Questions stay with their conversation.

4. `POST /data/{dataset_id}/index` with `{"prepared_id": "<returned prepared ID>", "partition": "train", "batch_size": 64}` embeds and upserts that partition into Qdrant.

Two read-only routes expose what the process is still holding, so a client that lost its
own state does not have to rerun the pipeline:

- `GET /data/prepared` lists every prepared ID with per-partition conversation and QA
  counts and the conversation IDs in each.
- `GET /data/prepared/{prepared_id}/questions?partition=train&conversation_id=...&limit=50`
  returns that partition's questions with category, annotated answer, and evidence turn
  IDs already split on `;`. The retrieval harness needs a question and its evidence turns
  to report recall at all, and R0 is scored against exactly these annotations.

`LoadDataset` uses `DatasetPort` to construct a `Dataset` entity. `CreateDatasetSplit` works only with IDs. `PrepareDataset` accepts that loaded entity and the split, so preparation performs no file access. Prepared partitions are retained for indexing and future evaluation; evaluation has no route yet.

Datasets, splits, and prepared results currently live in application memory. They are lost on restart and are not shared between server workers. Run a single worker for this workflow. A split ID belongs to the dataset ID it was created from.

## Docker Compose and UAT

From `2_Development/Deployment`, run:

```sh
docker compose up --build -d
docker compose ps
docker compose logs backend
```

The backend build installs `pip-tools` in a separate build stage, compiles
`requirements.in` to `requirements.txt`, then installs that file in the runtime
image. The generated file is stored inside the image at `/app/requirements.txt`;
it is not written back to the host. Dependency compilation is cached until
`requirements.in` changes or the build cache is bypassed. To refresh dependency
versions without editing the input file, run `docker compose build --no-cache backend`.

Check `http://localhost:8000/health`, then use `http://localhost:8000/docs`
to exercise the load, split, and prepare workflow above. Confirm successful
responses, reproducible splits for the same seed, category filtering, and
appropriate errors for missing files, invalid datasets, and invalid split sizes.
The project uses Docker Compose and manual UAT for verification.

On a host configured for NVIDIA GPU access, start the backend with the GPU
override from `2_Development/Deployment`:

```sh
docker compose -f docker-compose.yaml -f docker-compose.gpu.yaml up -d --build --wait backend
```

The override sets `LLM_DEVICE=gpu`, so `TransformersLLMAdapter` defaults to CUDA
inside that container. An explicit `device` argument takes precedence. The base
Compose file defaults to CPU and works on Docker Desktop for Mac.

## Liveness and readiness

`GET /health` answers from the API process alone. It touches nothing else, so it stays
fast and cannot fail for a reason outside the process; Compose's healthcheck and the
frontend's status indicator both use it.

`GET /ready` is the stricter question. It reports every dependency the API needs before
it can serve real work, which today means reaching Qdrant:

```json
{
  "ready": true,
  "dependencies": [
    {"name": "api", "label": "Backend API", "status": "ok", "detail": "..."},
    {"name": "memory_store", "label": "Memory store", "status": "ok",
     "detail": "509 memories indexed in 'memories'."}
  ],
  "facts": {"collection": "memories", "indexed_memories": 509, "reader_loaded": false}
}
```

The probe never builds the encoder and never loads a checkpoint — it is called while the
stack is still coming up, so triggering a model download would defeat the point. A
missing or unreachable store is reported as `unavailable` rather than raised, because a
readiness endpoint that 500s tells a caller nothing. `reader_loaded` is reported but
never gates readiness: weights load on first use by design, and waiting for them would
add minutes to every start.

The desktop loading screen polls this and will not show the console until `ready` is
true.

## Harness routes

The use cases behind the reward pipeline are reachable over HTTP as well as from the
command line. All of them load models lazily and share one copy: `presentation/resources.py`
holds a `ModelCache` with one language model per checkpoint and one `(BGEAdapter,
QdrantAdapter)` pair per process, and `GenerateText` loads through the same cache, so
`POST /model/generate` and the harness routes are never two copies of the same weights.
Construction is serialised, so a second request joins the first load instead of starting
its own download. Switching checkpoints releases the old model before allocating the new
one.

### The frozen configuration

`GET /model/info` reports the configured reader and encoder, their pinned revisions, the
devices, the collection name, the rewrite prompt version, and which checkpoint is
currently resident — without loading anything. Use it to state the configuration before
spending minutes on a model.

### Reader and rewriter

- `POST /model/tokens` with `{"text": "...", "max_new_tokens": 64}` counts text in the
  reader's tokens and reports the context window and whether the prompt plus its output
  allowance fits. Token budgets are measured in these tokens.
- `POST /model/rewrite` with `{"text": "...", "input_id": "probe", "seed": 123,
  "count": 8, "temperature": 0.7, "max_new_tokens": 48}` samples candidate search
  queries and deduplicates them case-insensitively, so fewer distinct queries than
  `count` is normal. Each candidate's seed derives from the seed, the input ID and the
  index, so the same three reproduce the same set.
- `POST /model/answer` with `{"question": "...", "context": "..."}` answers from a packed
  context using the R1 reader's prompt. A context that overruns the window returns
  `fits: false` with `skip_reason: "context_too_long"` and HTTP 200 rather than an error,
  because R1 treats that as an ineligible input rather than a wrong answer. `abstained`
  marks the answers R1 scores as zero.

### Retrieval and budget harness

`POST /retrieval/search`:

```json
{
  "conversation_id": "conv-26",
  "queries": ["What hobby did Alice start?", "Alice new hobby"],
  "top_k": 20,
  "token_budgets": [128, 256, 512],
  "expected_turn_ids": ["D1:1", "D1:4"]
}
```

Up to eight queries are embedded and searched once each; every budget is then a separate
pack of the same ranked list, so a budget curve costs no extra search. Each query reports
its matches with scores and source turns, the rank of the first expected turn, and per
budget the packed text, the tokens used, the turns carried and evidence recall. When
expected turns are supplied and there are at least two queries, the response also names
the winner using the same `select_rewrite` rule the dataset build uses. Optional
`eligible_turn_ids` restricts the search the way R2 does. Returns 409 when the collection
does not exist, which means nothing has been indexed yet.

### Reward bank

- `GET /rewards` lists the four scorers with the signal each uses, whether it is
  label-free, whether it needs questions, and the skip reasons it can report. Served
  rather than hard-coded in clients so a UI cannot offer a reward this build lacks, and
  so R0 is labelled as the only scorer that reads evidence annotations.
- `POST /rewards/select` with `{"scores": [...]}` applies the winner rule and reports the
  tie count, or `reason: "all_scores_tied"` / `"too_few_candidates"` when no example
  would be kept.
- `POST /rewards/evidence` with expected and actual turn IDs returns recall and the
  matched turns.

### Reward datasets over HTTP

`POST /rewards/datasets`:

```json
{
  "prepared_id": "<returned prepared ID>",
  "partition": "train",
  "rewards": ["r0", "r1", "r2", "r3"],
  "max_inputs_per_reward": 4,
  "candidates": 4,
  "temperature": 0.7,
  "top_k": 20,
  "token_budget": 512
}
```

The same pipeline as `presentation/build_reward_datasets.py`: sample candidates, retrieve
and pack for each, score every candidate with each selected reward, and keep the winner.
The response carries each reward's attempted/kept counts, the skip histogram, the tie
count, every kept `prompt`/`completion` pair and one diagnostic row per attempted input.

This route builds pilot datasets from the training partition. It runs synchronously and
returns 409 if indexing or another reward build is in progress. The request caps
`max_inputs_per_reward` at 50 and `candidates` at 16. Index the training conversation
data through `POST /data/{dataset_id}/index` first. R0 and R1 require training questions.
The command-line builder handles full data runs and writes the manifest.

For long builds, the frontend uses `POST /rewards/builds` with the same request
fields. Set `max_inputs_per_reward` to null to use the entire training partition,
or pass a positive count. Poll `GET /rewards/builds/{id}` for the number of
attempted inputs per reward and the completed result. The backend keeps the latest
job in memory and saves completed reward datasets in `/artifacts/datasets`.
Set `keep_all_one_ties` to true (CLI `--keep-all-one-ties`) to keep one R0 rewrite
when every candidate has evidence recall 1.0. Other all-tied inputs are skipped.
New diagnostics record the shared score and identify rewrites kept by this option.
Send `POST /rewards/builds/{id}/cancel` to stop a running build. Poll until it is
`cancelled`. The active operation finishes before the job stops. If publication
has already started, the job finishes saving the completed datasets.

## Build reward datasets

From `2_Development/Deployment`, run a small pilot on the bundled LoCoMo data:

```sh
docker compose build backend
docker compose run --rm backend python -m presentation.build_reward_datasets \
  --dataset /data/locomo10.json --output /artifacts/pilot \
  --train-size 1 --validation-size 2 --test-size 7 --max-inputs-per-reward 8
```

The command indexes the training conversations in a collection scoped to the corpus,
split, and embedding configuration. Use `--rewards r0 r1` to select a subset, and
`--help` to see the sampling and retrieval settings. For a custom checkpoint, pass
`--model-id` and a pinned `--model-revision`. Each build uses one frozen checkpoint
for rewriting and reader tasks.

Every build publishes one saved dataset per reward under `/artifacts/datasets`.
Use the IDs printed by the CLI or returned as `results[].dataset_id` by the API.
The optional `--output` flag also writes an export. In the example, that export
appears in `2_Development/.artifacts/pilot`. Each reward has a JSONL file of
`prompt` and `completion` pairs and a diagnostics file with one outcome per attempted
input. The manifest records the split, settings, revisions, and counts. A pilot can
produce an empty file if no input has two distinct rewrites with different scores.
Use a new output directory for another run.

## Train a rewrite adapter

Send `POST /training/runs` with a saved `dataset_id`. By default the run uses the
Hugging Face model and exact commit recorded when that dataset was built. Older
datasets without a recorded Hub model and commit use the configured base
checkpoint. `model_id` and `revision` are optional overrides. A revision alone
applies to the default model for that dataset. When choosing a different model,
either supply its revision or let the worker resolve that model's default revision.
Optional `name`, `notes`, and `settings` fields customize the run:

```json
{
  "dataset_id": "<saved dataset UUID>",
  "name": "R0 CPU pilot",
  "settings": {"epochs": 1, "max_length": 512}
}
```

Settings also accept `seed`, `learning_rate`, `batch_size`,
`gradient_accumulation_steps`, `lora_rank`, and `lora_alpha`. The response is
`202 Accepted` with a run record and a `Location` header for polling. One training
run can be queued or running. Additional starts return `409 Conflict`. Run status
is `queued`, `running`, `completed`, `failed`, or `interrupted`. The worker trains on
complete prompt/rewrite pairs that fit the token limit and reports skipped row counts.
The run records the revision selected at queue time in `requested_revision` and
the exact commit loaded by the worker in `model_revision` on completion.
CPU is the default. The existing Compose GPU override sets `LLM_DEVICE=gpu`.

Both `/rewards/datasets` and `/training/runs` have the same management endpoints:

| Method and suffix | Behavior |
| --- | --- |
| `GET` on the collection | List saved manifests, newest first |
| `GET /{id}` | Inspect the artifact or poll a run for progress and metrics |
| `PATCH /{id}` | Update `name` or `notes` |
| `GET /{id}/download` | Download a ZIP with the manifest and dataset or completed adapter |
| `DELETE /{id}` | Delete the artifact. A run or dataset in use returns `409 Conflict` |

Rebuilding creates new dataset IDs. Raw training rows and completed adapter weights
stay fixed. A completed run retains the source dataset ID and hash if that dataset
is deleted. Compose stores these artifacts in `2_Development/.artifacts` on the host.
Set `ARTIFACTS_DIR` when running the API or builder outside Docker.

## Application structure

- `application/use_cases/dataset`: loading, split creation, preparation, and indexing.
- `application/use_cases/generation`: text generation, query rewriting, and answering.
- `application/use_cases/retrieval`: query search, context packing, and evidence scoring.
- `application/use_cases/rewards`: input builders and scorers for R0–R3.
- `application/use_cases/training`: selecting rewrites, saving reward datasets, and fine-tuning.
- `application/use_cases/evaluation`: evaluation use cases. Empty; no route yet.
- `application/ports/models`: interfaces for embedding, generation, tokenization, and continuation scoring.
- `infrastructure/models`: concrete model adapters implementing those interfaces.

Concrete models do not belong in `domain/entities`. Domain entities describe application data and rules; model adapters perform embedding or training through application ports.

## Infrastructure and configuration

Adapter packages mirror the application ports: `infrastructure/dataset` implements
`application/ports/dataset`, `infrastructure/memory_store` implements
`application/ports/memory_store`, and `infrastructure/models` mirrors
`application/ports/models`. Add adapter categories when corresponding application
ports are introduced; avoid placeholder packages for anticipated capabilities.

`infrastructure/config.py` holds versioned defaults, currently the API title,
dataset split seed, and Qdrant collection name. Request parameters can override
the default split seed. Application and domain modules remain independent of
infrastructure configuration; defaults are supplied at the presentation boundary.

For local runs, copy `.env.example` to `.env` in the backend directory. It currently
contains `QDRANT_URL` and `FRONTEND_URL`. Exported variables override `.env`; the fallback is
`http://localhost:6333`. Docker Compose supplies `http://qdrant:6333` for its network.
Use `.env` for deployment-specific values and future secrets, and config for
shared, versioned defaults. `.env` is not restricted to URLs.

`QdrantAdapter.from_config(vector_size=...)` uses the configured URL and collection;
its regular constructor still accepts an explicit client and collection. Vector
size must come from the chosen embedding model. The index route opens a Qdrant connection on first use; startup does not connect.

## Browser access (CORS)

The backend allows cross-origin browser access only from `FRONTEND_URL`, defaulting
to `http://localhost:5173`, with GET/POST methods and the Content-Type header.
Cookies and credentialed cross-origin requests are disabled. Set the URL to the
exact browser origin (scheme, host, and port, without a trailing slash or path).
For Compose, export `FRONTEND_URL` or put it in `Deployment/.env` before starting;
Compose passes it to the backend. The backend's own `.env` applies to local runs.

During UAT, use the frontend origin to check a request and its OPTIONS preflight;
a different origin's preflight should return 400 without an allow-origin header.
CORS controls browsers' cross-origin access, not authentication or network access;
command-line and server clients can still reach published API endpoints. Compose
publishes backend and Qdrant ports only on the local host. Qdrant is an outbound
service dependency of the backend and does not need a backend CORS allowance.

## BGE embeddings

`infrastructure/models/embedding/BGEAdapter` implements `EmbeddingPort` with
`BAAI/bge-base-en-v1.5` (768 dimensions). Config pins its checkpoint revision,
CPU device, batch size of 32, and 512-token input limit. Longer inputs are
truncated, including the query instruction within the limit. Weights are frozen
and outputs are normalized. Documents receive no prefix; queries receive BGE's
retrieval instruction. This uses the base v1.5 checkpoint, not PPRO's large model.

Construct one adapter per process and reuse it:

```python
from infrastructure.models.embedding import BGEAdapter
from infrastructure.memory_store import QdrantAdapter
from application.use_cases.dataset import IndexDataset

embedder = BGEAdapter()
store = QdrantAdapter.from_config(vector_size=embedder.vector_size)
store.ensure_collection()
indexer = IndexDataset(embedder, store)
# indexer.execute(prepared.train.conversations)
# query_vector = embedder.embed_queries(["What does Alice enjoy?"])[0]
# matches = store.search(query_vector, conversation_id="...", limit=10)
```

The first construction downloads public model weights; no API key is required.
Docker caches them in a named volume so container replacement can reuse them.
API startup does not construct the adapter, and the index route constructs the adapter on first use.
Set `embedding_device` to `cuda` only in a GPU-enabled runtime. Reindex into a
separate collection whenever model, revision, or document encoding settings
change. Never mix vectors from different embedding configurations.

For Docker/UAT, after building, run this from `2_Development/Deployment`:

```sh
docker compose exec backend python -c 'from infrastructure.models.embedding import BGEAdapter; e = BGEAdapter(); print(e.vector_size, len(e.embed_queries(["Where did Alice travel?"])[0]), len(e.embed_documents(["Alice visited Denver."])[0]))'
```

Expected output is `768 768 768` after the initial model download.

## Index a prepared partition

`POST /data/{dataset_id}/index` invokes `IndexDataset`:

```json
{"prepared_id": "<returned prepared ID>", "partition": "train", "batch_size": 64}
```

Partition defaults to `train`; use `validation` or `test` explicitly to index those
conversations. Only conversation turns are embedded; QA annotations are excluded.
The response reports indexed memory count, collection, model/revision, and vector
size. The prepared ID must belong to the dataset or the route returns 404. Invalid
partition/batch values return 422; incompatible collection configuration returns
409; model or storage failures return 503 with details in backend logs.

The first request downloads/loads BGE and ensures the Qdrant collection. Requests
run synchronously and serialize indexing per process; use the single-worker setup.
Successful initialization is cached for later requests. Retrying upserts the same
memory IDs; a failed request can leave completed batches in Qdrant. Counts describe
processed memories, not newly inserted points. All partitions share the configured
collection, with retrieval filtered by conversation ID. Dataset IDs are API handles,
not vector namespaces: datasets reusing conversation IDs share those memories.

For UAT, complete load/split/prepare, index a partition, inspect the collection in
Qdrant, then repeat the request and confirm point count does not increase. Also
check an unrelated prepared ID returns 404 and invalid partition/batch values
return 422. First-time downloads and CPU embedding can take time.
