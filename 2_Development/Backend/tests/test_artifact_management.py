from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from application.use_cases.training.build_reward_dataset import RewardDataset, TrainingExample
from infrastructure.training.artifact_store import FileArtifactStore
from presentation.artifact_routes import artifact_router


class ArtifactManagementTest(TestCase):
    def test_rename_and_delete_dataset_returns_204_and_removes_files(self):
        with TemporaryDirectory() as temporary:
            store = FileArtifactStore(Path(temporary))
            artifact = store.save_datasets({'r0': RewardDataset(examples=[TrainingExample('prompt', 'answer')])}, {
                'partition': 'train', 'settings': {'seed': 123, 'max_inputs_per_reward': 32},
            })['r0']
            self.assertIn('pilot 32', artifact['name'])
            self.assertIn('seed 123', artifact['name'])
            app = FastAPI()
            app.state.artifact_store = store
            app.include_router(artifact_router('/datasets', 'datasets'))
            with TestClient(app) as client:
                renamed = client.patch(f"/datasets/{artifact['id']}", json={'name': 'My pilot', 'notes': 'Validation experiment'})
                self.assertEqual(renamed.status_code, 200)
                self.assertEqual(renamed.json()['name'], 'My pilot')
                deleted = client.delete(f"/datasets/{artifact['id']}")
                self.assertEqual(deleted.status_code, 204)
                self.assertEqual(deleted.content, b'')
                self.assertEqual(client.get('/datasets').json(), [])
                self.assertEqual(client.get(f"/datasets/{artifact['id']}").status_code, 404)
                self.assertFalse((Path(temporary) / 'datasets' / artifact['id']).exists())

    def test_dataset_used_by_active_training_cannot_be_deleted(self):
        with TemporaryDirectory() as temporary:
            store = FileArtifactStore(Path(temporary))
            artifact = store.save_datasets({'r0': RewardDataset()}, {})['r0']
            run_id = str(uuid4())
            store.write('runs', run_id, {'id': run_id, 'dataset_id': artifact['id'], 'status': 'running', 'created_at': '2025-01-01'})
            app = FastAPI()
            app.state.artifact_store = store
            app.include_router(artifact_router('/datasets', 'datasets'))
            with store.open_worker_lock(), TestClient(app) as client:
                result = client.delete(f"/datasets/{artifact['id']}")
                self.assertEqual(result.status_code, 409, result.text)
                self.assertIn('active training', result.json()['detail'])
                self.assertEqual(len(client.get('/datasets').json()), 1)
