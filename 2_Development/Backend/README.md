# Dataset workflow

The dataset router (`presentation/routes_dataset.py`) exposes four explicit stages. Run the API and open `/docs` to try them.

1. `POST /data/load` with `{"path": "/data/locomo10.json"}` loads a server-local LoCoMo JSON file. It returns a `dataset_id`, conversation IDs, and conversation/QA counts. With Docker Compose, place the file in `2_Development/.data`; that folder is mounted at `/data`.
2. `POST /data/{dataset_id}/splits` with `{"train_size": 6, "validation_size": 2, "test_size": 2, "seed": 123}` creates a split. Sizes must sum to the loaded conversation count. The response contains a `split_id` and each partition's conversation IDs. The same IDs and seed produce the same assignment, regardless of input order.
3. `POST /data/{dataset_id}/prepare` with `{"split_id": "<returned split ID>", "categories": ["single_hop", "multi_hop"]}` validates the dataset and applies the split and optional QA category filter. Omit `categories` to include all categories; an empty list includes no QA. The response returns a `prepared_id`, validation status, and conversation/QA counts for each partition. Questions stay with their conversation.

4. `POST /data/{dataset_id}/index` with `{"prepared_id": "<returned prepared ID>", "partition": "train", "batch_size": 64}` embeds and upserts that partition into Qdrant.

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

## Application structure

- `application/use_cases/dataset`: loading, split creation, preparation, and indexing.
- `application/use_cases/training`: reserved for model training and fine-tuning use cases.
- `application/use_cases/evaluation`: evaluation use cases.
- `application/ports/models`: model interfaces, currently `EmbeddingPort`. Add a separate fine-tuning port when the training contract is defined.
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
