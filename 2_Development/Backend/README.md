# Dataset workflow

The data router exposes three explicit stages. Run the API and open `/docs` to try them.

1. `POST /data/load` with `{"path": "/data/locomo10.json"}` loads a server-local LoCoMo JSON file. It returns a `dataset_id`, conversation IDs, and conversation/QA counts. With Docker Compose, place the file in `2_Development/.data`; that folder is mounted at `/data`.
2. `POST /data/{dataset_id}/splits` with `{"train_size": 6, "validation_size": 2, "test_size": 2, "seed": 123}` creates a split. Sizes must sum to the loaded conversation count. The response contains a `split_id` and each partition's conversation IDs. The same IDs and seed produce the same assignment, regardless of input order.
3. `POST /data/{dataset_id}/prepare` with `{"split_id": "<returned split ID>", "categories": ["single_hop", "multi_hop"]}` validates the dataset and applies the split and optional QA category filter. Omit `categories` to include all categories; an empty list includes no QA. The response returns a `prepared_id`, validation status, and conversation/QA counts for each partition. Questions stay with their conversation.

`LoadDataset` uses `DatasetPort` to construct a `Dataset` entity. `CreateDatasetSplit` works only with IDs. `PrepareDataset` accepts that loaded entity and the split, so preparation performs no file access. Prepared partitions are retained for future indexing/evaluation integration; those stages have no routes yet.

Datasets, splits, and prepared results currently live in application memory. They are lost on restart and are not shared between server workers. Run a single worker for this workflow. A split ID belongs to the dataset ID it was created from.

## Tests

Install the backend requirements and `httpx`, then run from this directory:

```sh
python -m unittest discover -s tests -v
```
