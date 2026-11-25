import json
from contextlib import asynccontextmanager
from dataclasses import replace
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from qdrant_client import QdrantClient, models

from infrastructure.dataset.workspace_store import DatasetWorkspaceStore
from infrastructure.memory_store.qdrant_adapter import QdrantAdapter
from presentation import routes_dataset as routes
from presentation import routes_reward_datasets as reward_routes
from presentation.dataset_workspace import restore_index_ownership


class DatasetWorkspaceTest(TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / 'locomo.json'
        self.source.write_text(json.dumps([{
            'sample_id': 'c1', 'conversation': {
                'speaker_a': 'Alice', 'speaker_b': 'Bob',
                'session_1_date_time': '1:00 pm on 1 January, 2025',
                'session_1': [{'dia_id': 'D1:1', 'speaker': 'Alice', 'text': 'I moved to Denver.'}],
            }, 'qa': [{'question': 'Where did Alice move?', 'answer': 'Denver', 'category': 4, 'evidence': ['D1:1']}],
        }]))
        self.calls = []
        def embed(texts):
            self.calls.append(texts)
            return [[1.0, 0.0, 0.0] for _ in texts]
        self.embedder = SimpleNamespace(vector_size=3, embed_documents=embed)
        self.client = QdrantClient(':memory:')
        self.store = QdrantAdapter(self.client, 'memories', 3)
        self.store.ensure_collection()
        # The test shares one in-memory database between simulated processes.
        self.close_patch = patch.object(self.client, 'close')
        self.close_patch.start()
        self.addCleanup(self.close_patch.stop)
        self.resources = patch.object(routes, 'memory_resources', return_value=(self.embedder, self.store))
        self.resources.start()
        self.addCleanup(self.resources.stop)
        self.adapter = patch('presentation.dataset_workspace.QdrantAdapter.from_config', return_value=self.store)
        self.adapter.start()
        self.addCleanup(self.adapter.stop)

    def app(self):
        workspace = DatasetWorkspaceStore(self.root)
        @asynccontextmanager
        async def lifespan(app):
            workspace.restore(app.state)
            restore_index_ownership(app.state)
            yield
        app = FastAPI(lifespan=lifespan)
        app.state.dataset_workspace_store = workspace
        app.include_router(routes.router)
        app.include_router(reward_routes.router, prefix="/rewards")
        return app

    def prepare(self, client):
        loaded = client.post('/data/load', json={'path': str(self.source)})
        self.assertEqual(loaded.status_code, 201, loaded.text)
        dataset = loaded.json()['dataset_id']
        split = client.post(f'/data/{dataset}/splits', json={'train_size': 1, 'validation_size': 0, 'test_size': 0, 'seed': 123})
        self.assertEqual(split.status_code, 201, split.text)
        prepared = client.post(f'/data/{dataset}/prepare', json={'split_id': split.json()['split_id'], 'categories': ['single_hop']})
        self.assertEqual(prepared.status_code, 200, prepared.text)
        return dataset, prepared.json()['prepared_id']

    def index(self, client, dataset, prepared):
        return client.post(f'/data/{dataset}/index', json={'prepared_id': prepared, 'partition': 'train', 'batch_size': 1})

    def test_native_data_directory_keeps_the_docker_dataset_path_usable(self):
        with TestClient(self.app()) as client, patch.object(
            routes, 'config', replace(routes.config, dataset_dir=self.root),
        ):
            loaded = client.post('/data/load', json={'path': '/data/locomo.json'})
            self.assertEqual(loaded.status_code, 201, loaded.text)
            self.assertEqual(loaded.json()['conversation_count'], 1)

    def test_restart_restores_questions_provenance_and_reuses_index(self):
        with TestClient(self.app()) as client:
            dataset, prepared = self.prepare(client)
            indexed = self.index(client, dataset, prepared)
            self.assertEqual(indexed.status_code, 200, indexed.text)
            self.assertFalse(indexed.json()['reused'])
            self.assertEqual(len(self.calls), 1)
        with TestClient(self.app()) as client:
            handles = client.get('/data/prepared').json()
            self.assertEqual(handles[0]['prepared_id'], prepared)
            self.assertTrue(handles[0]['partitions']['train']['indexed'])
            self.assertTrue(handles[0]['provenance']['corpus_sha256'])
            self.assertEqual(client.get(f'/data/prepared/{prepared}/questions').json()['total'], 1)
            self.assertEqual(self.prepare(client), (dataset, prepared), 'unchanged setup must reuse stable handles')
            result = self.index(client, dataset, prepared)
            self.assertEqual(result.status_code, 200, result.text)
            self.assertTrue(result.json()['reused'])
            self.assertEqual(len(self.calls), 1, 'restoration must not re-embed')

    def test_wiped_collection_is_not_ready_but_preparation_survives(self):
        with TestClient(self.app()) as client:
            dataset, prepared = self.prepare(client)
            self.assertEqual(self.index(client, dataset, prepared).status_code, 200)
        self.client.delete_collection('memories')
        self.store.ensure_collection()
        with TestClient(self.app()) as client:
            handle = client.get('/data/prepared').json()[0]
            self.assertFalse(handle['partitions']['train']['indexed'])
            self.assertEqual(handle['prepared_id'], prepared)
            result = self.index(client, dataset, prepared)
            self.assertEqual(result.status_code, 200, result.text)
            self.assertFalse(result.json()['reused'])
            self.assertEqual(len(self.calls), 2)

    def test_reward_builds_use_only_the_active_training_set_after_reload_and_restart(self):
        with TestClient(self.app()) as client:
            dataset, first = self.prepare(client)
            self.assertEqual(self.index(client, dataset, first).status_code, 200)
            provenance = client.get('/data/prepared').json()[0]['provenance']
            prepared = client.post(
                f'/data/{dataset}/prepare', json={'split_id': provenance['split_id']},
            )
            self.assertEqual(prepared.status_code, 200, prepared.text)
            second = prepared.json()['prepared_id']
            self.assertNotEqual(first, second)
            self.assertEqual(self.index(client, dataset, second).status_code, 200)
            self.assertEqual(self.prepare(client), (dataset, first))
            self.assertEqual(len(self.calls), 1, 'the same conversations should reuse embeddings')

        with TestClient(self.app()) as client, patch.object(reward_routes, 'language_model') as model:
            active = [item for item in client.get('/data/prepared').json() if item['active_training']]
            self.assertEqual([item['prepared_id'] for item in active], [second])
            for endpoint in ('/rewards/datasets', '/rewards/builds'):
                response = client.post(endpoint, json={'prepared_id': first, 'rewards': ['r0']})
                self.assertEqual(response.status_code, 409, response.text)
                self.assertIn('active training set', response.json()['detail'])
            with patch.object(reward_routes, '_build', return_value=None):
                response = client.post('/rewards/builds', json={'prepared_id': second, 'rewards': ['r0']})
                self.assertEqual(response.status_code, 202, response.text)
            model.assert_not_called()

    def test_interrupted_index_is_invalidated_durably(self):
        with TestClient(self.app()) as client:
            dataset, prepared = self.prepare(client)
            self.assertEqual(self.index(client, dataset, prepared).status_code, 200)
            self.client.delete('memories', points_selector=models.FilterSelector(filter=models.Filter()))
            with patch.object(self.store, 'upsert', side_effect=RuntimeError('interrupted')):
                self.assertEqual(self.index(client, dataset, prepared).status_code, 503)
        with TestClient(self.app()) as client:
            self.assertFalse(client.get('/data/prepared').json()[0]['partitions']['train']['indexed'])
            self.assertEqual(self.index(client, dataset, prepared).status_code, 200)

    def test_modified_payload_and_extra_points_are_not_reused(self):
        with TestClient(self.app()) as client:
            dataset, prepared = self.prepare(client)
            self.assertEqual(self.index(client, dataset, prepared).status_code, 200)
            self.client.set_payload('memories', payload={'index_signature': 'wrong'}, points=models.Filter())
            self.assertFalse(client.get('/data/prepared').json()[0]['partitions']['train']['indexed'])
            self.assertFalse(self.index(client, dataset, prepared).json()['reused'])
            self.client.upsert('memories', points=[models.PointStruct(id=123, vector=[1., 0., 0.], payload={'conversation_id': 'c1'})])
            self.assertFalse(self.index(client, dataset, prepared).json()['reused'])
            self.assertEqual(self.client.count('memories').count, 1, 'reindex removes stale conversation points')

    def test_changed_embedding_signature_cannot_reuse_index(self):
        from dataclasses import replace
        from infrastructure.config import config
        with TestClient(self.app()) as client:
            dataset, prepared = self.prepare(client)
            self.assertEqual(self.index(client, dataset, prepared).status_code, 200)
            with patch('presentation.dataset_workspace.config', replace(config, embedding_revision='changed')):
                self.assertFalse(client.get('/data/prepared').json()[0]['partitions']['train']['indexed'])

    def test_failed_snapshot_write_keeps_previous_state_and_removes_temporary_file(self):
        app = self.app()
        workspace = app.state.dataset_workspace_store
        workspace.restore(app.state)
        workspace.save(app.state)
        original = workspace.path.read_bytes()
        app.state.corpus_hashes = {'new': 'digest'}
        with patch('infrastructure.dataset.workspace_store.os.replace', side_effect=OSError('disk failure')):
            with self.assertRaises(OSError):
                workspace.save(app.state)
        self.assertEqual(workspace.path.read_bytes(), original)
        self.assertEqual(list(workspace.path.parent.iterdir()), [workspace.path])

    def test_unsupported_snapshot_version_is_not_silently_discarded(self):
        app = self.app()
        workspace = app.state.dataset_workspace_store
        workspace.path.parent.mkdir(parents=True)
        workspace.path.write_text('{"version":99}')
        with self.assertRaises(ValueError):
            workspace.restore(app.state)
