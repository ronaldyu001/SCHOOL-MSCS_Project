from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch
from time import monotonic, sleep

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from presentation import routes_reward_datasets as routes

from application.use_cases.training.build_reward_dataset import RewardBuildSettings
from application.use_cases.training.build_reward_datasets import BuildRewardDatasets
from application.use_cases.training.manage_artifacts import SaveRewardDatasets
from domain.entities import Conversation, DatasetPartition, QA, Session, Turn
from infrastructure.training.artifact_store import FileArtifactStore
from presentation.routes_reward_datasets import RewardBuildJob, RewardDatasetRequest


class RewardBuildTest(TestCase):
    def test_all_rewards_produce_reloadable_training_examples(self):
        turns = (Turn('t1', 'Alice', 'Alice moved to Denver.'),
                 Turn('t2', 'Bob', 'Bob likes Denver.'),
                 Turn('t3', 'Alice', 'Alice enjoys hiking.'))
        partition = DatasetPartition(
            conversations=(Conversation('c1', ('Alice', 'Bob'),
                (Session(1, datetime(2025, 1, 1), turns),)),),
            qa=(QA('q1', 'c1', 'Where did Alice move?', 'single_hop',
                   evidence_turn_ids=('t1',)),),
        )
        calls = []
        rewrites = []

        def generate(prompt, **kwargs):
            if prompt.startswith('Turn each input'):
                query = 'good query' if len(rewrites) % 2 == 0 else 'bad query'
                rewrites.append(query)
                return query
            if prompt.startswith('Write one standalone question'):
                return 'Where did Alice move?'
            return 'Denver'

        def search(vector, conversation_id, top_k, *, eligible_turn_ids=None):
            calls.append((conversation_id, eligible_turn_ids))
            if not vector[0]:
                return []
            ids = tuple(t.id for t in turns if eligible_turn_ids is None or t.id in eligible_turn_ids)
            return [SimpleNamespace(memory=SimpleNamespace(text='Denver', source_turn_ids=ids))]

        model = SimpleNamespace(generate=generate)
        tokenizer = SimpleNamespace(count_tokens=lambda text: len(text.split()),
                                    prompt_fits=lambda *args, **kwargs: True)
        scorer = SimpleNamespace(mean_log_probability=lambda prompt, continuation:
                                 -1.0 if prompt.startswith('Retrieved memories:') else -2.0)
        embedder = SimpleNamespace(embed_queries=lambda queries:
                                   [(int(q.startswith('good')), ) for q in queries])
        datasets = BuildRewardDatasets(model, tokenizer, scorer, embedder,
            SimpleNamespace(search=search)).execute(
                partition, ['r0', 'r1', 'r2', 'r3'],
                RewardBuildSettings(candidates=2, max_inputs_per_reward=1),
            )
        self.assertEqual(set(datasets), {'r0', 'r1', 'r2', 'r3'})
        for reward, dataset in datasets.items():
            self.assertEqual(len(dataset.examples), 1, (reward, dataset.summary()))
            self.assertEqual(dataset.examples[0].completion, 'good query')
            self.assertIn('Query:', dataset.examples[0].prompt)
        self.assertTrue(any(scope is not None for _, scope in calls), 'R2 must restrict retrieval to earlier turns')
        with TemporaryDirectory() as temporary:
            store = FileArtifactStore(Path(temporary))
            saved = SaveRewardDatasets(store).execute(datasets, {'partition': 'train'})
            for reward, manifest in saved.items():
                self.assertEqual(manifest['row_count'], 1)
                self.assertEqual(store.load_examples(manifest['id'], manifest['dataset_sha256']),
                                 datasets[reward].examples)

    def test_job_lifecycle_never_returns_null_status(self):
        job = RewardBuildJob(attempted={'r0': 0})
        self.assertEqual(job.status().status, 'running')
        self.assertEqual(job.status().id, job.id)
        job.report('r0', 1)
        self.assertEqual(job.status().attempted, {'r0': 1})
        job.request_stop()
        self.assertEqual(job.status().status, 'cancelling')
        job.future.set_result(None)
        self.assertEqual(job.status().status, 'cancelled')

    def test_model_window_is_not_a_valid_retrieval_budget(self):
        with self.assertRaises(ValueError):
            RewardDatasetRequest(prepared_id='prepared', token_budget=32768)

    def test_async_api_reports_completion_and_worker_errors(self):
        app = FastAPI()
        app.include_router(routes.router, prefix="/rewards")
        response = routes.RewardDatasetResponse(
            prepared_id="prepared", partition="train", conversation_count=1,
            qa_count=1, collection="test", model_id="test/model", model_revision=None,
            embedding_model="test/embedding", rewrite_prompt_version="1",
            reward_pipeline_version=2, settings={}, results=[], elapsed_seconds=0,
        )
        with TestClient(app) as client, patch.object(routes, "_prepare_build", return_value=(None, None)), patch.object(routes, "require_indexed_partition"):
            self.assertEqual(client.get("/rewards/builds").json(), {"job": None})
            active = RewardBuildJob(attempted={"r0": 7})
            app.state.reward_build_job = active
            discovered = client.get("/rewards/builds").json()["job"]
            self.assertEqual(discovered["id"], str(active.id))
            self.assertEqual(discovered["attempted"], {"r0": 7})
            active.future.set_result(None)
            self.assertEqual(client.get("/rewards/builds").json(), {"job": None})
            for error in (False, True):
                def build(*args):
                    if error:
                        raise HTTPException(status_code=503, detail="Test build failure")
                    return response

                with patch.object(routes, "_build", side_effect=build):
                    started = client.post("/rewards/builds", json={"prepared_id": "prepared"})
                    self.assertEqual(started.status_code, 202, started.text)
                    job = started.json()
                    self.assertTrue(job["id"])
                    deadline = monotonic() + 3
                    while monotonic() < deadline:
                        status = client.get(f"/rewards/builds/{job['id']}")
                        if status.status_code != 200 or status.json()["status"] == "completed":
                            break
                        sleep(0.01)
                    else:
                        self.fail("Build never finished")
                    if error:
                        self.assertEqual(status.status_code, 503)
                        self.assertEqual(status.json()["detail"], "Test build failure")
                    else:
                        self.assertEqual(status.json()["result"]["prepared_id"], "prepared")
