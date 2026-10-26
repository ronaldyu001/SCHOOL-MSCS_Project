import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from fastapi.testclient import TestClient

from application.use_cases.training import CreateDatasetSplit, PrepareDataset
from domain.entities import Conversation, Dataset, DatasetSplit, QA
from main import app


class DatasetFlowTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "dataset.json"
        self.path.write_text(json.dumps([
            {
                "sample_id": f"c{i}",
                "conversation": {
                    "speaker_a": "A", "speaker_b": "B",
                    "session_1_date_time": "1:00 PM on 01 January, 2024",
                    "session_1": [{"dia_id": "D1:1", "speaker": "A", "text": "Hello"}],
                },
                "qa": [
                    {"question": "Who?", "answer": "A", "category": category}
                    for category in (1, 4)
                ],
            }
            for i in range(4)
        ]))
        app.state.datasets = {}
        app.state.dataset_splits = {}
        app.state.prepared_datasets = {}
        self.client = TestClient(app)

    def load(self):
        response = self.client.post("/data/load", json={"path": str(self.path)})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["dataset_id"]

    def split(self, dataset_id):
        response = self.client.post(f"/data/{dataset_id}/splits", json={
            "train_size": 2, "validation_size": 1, "test_size": 1,
        })
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_complete_flow_and_category_filter(self):
        dataset_id = self.load()
        split = self.split(dataset_id)
        ids = sum([split[f"{name}_conversation_ids"] for name in ("train", "validation", "test")], [])
        self.assertEqual(set(ids), {"c0", "c1", "c2", "c3"})
        self.assertEqual(len(ids), len(set(ids)))
        response = self.client.post(f"/data/{dataset_id}/prepare", json={
            "split_id": split["split_id"], "categories": ["single_hop"],
        })
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["validation_status"], "passed")
        self.assertEqual(result["partitions"]["train"], {"conversation_count": 2, "qa_count": 2})
        self.assertEqual(result["partitions"]["test"]["qa_count"], 1)
        self.assertIn(result["prepared_id"], app.state.prepared_datasets)

    def test_missing_dataset_and_wrong_dataset_split(self):
        self.assertEqual(self.client.post("/data/missing/splits", json={
            "train_size": 2, "validation_size": 1, "test_size": 1,
        }).status_code, 404)
        first = self.load()
        split = self.split(first)
        second = self.load()
        self.assertEqual(self.client.post(f"/data/{second}/prepare", json={
            "split_id": split["split_id"],
        }).status_code, 404)

    def test_invalid_file_and_split_sizes(self):
        self.path.write_text("invalid json")
        self.assertEqual(self.client.post("/data/load", json={"path": str(self.path)}).status_code, 422)
        self.assertEqual(self.client.post("/data/load", json={"path": str(self.path)+"missing"}).status_code, 404)
        app.state.datasets["sample"] = Dataset((Conversation("c1", (), ()),), ())
        for train_size in (2, -1, 0.5, True):
            response = self.client.post("/data/sample/splits", json={
                "train_size": train_size, "validation_size": 0, "test_size": 0,
            })
            self.assertEqual(response.status_code, 422)

    def test_split_is_reproducible(self):
        create = CreateDatasetSplit()
        self.assertEqual(create.execute(["b", "a", "c"], 1, 1, 1), create.execute(["c", "b", "a"], 1, 1, 1))

    def test_prepare_rejects_orphan_qa_and_incomplete_split(self):
        conversation = Conversation("c1", (), ())
        split = DatasetSplit(("c1",), (), ())
        with self.assertRaisesRegex(ValueError, "unknown conversations"):
            PrepareDataset().execute(Dataset((conversation,), (QA("q1", "missing", "?", "single_hop"),)), split)
        with self.assertRaisesRegex(ValueError, "every conversation"):
            PrepareDataset().execute(Dataset((conversation,), ()), DatasetSplit((), (), ()))


if __name__ == "__main__":
    unittest.main()
