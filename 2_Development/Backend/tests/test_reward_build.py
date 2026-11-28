from datetime import datetime
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Barrier, Event
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import Mock, patch
from time import monotonic, sleep
from urllib.error import HTTPError

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import torch
from presentation import routes_reward_datasets as routes

from application.ports.models import ContextWindowExceeded
from application.use_cases.generation.rewrite_query import RewriteCandidates, RewriteQuery
from application.use_cases.rewards import RewardInput
from application.use_cases.training.build_reward_dataset import BuildRewardDataset, RewardBuildSettings
from application.use_cases.training.build_reward_datasets import BuildRewardDatasets
from application.use_cases.training.manage_artifacts import SaveRewardDatasets
from domain.entities import Conversation, DatasetPartition, QA, Session, Turn
from infrastructure.models.llm.runtime import resolve_device
from infrastructure.models.llm import openai_llm_adapter
from infrastructure.models.llm.transformers_llm_adapter import _sampling_rng
from infrastructure.training.artifact_store import FileArtifactStore
from presentation.routes_reward_datasets import RewardBuildJob, RewardDatasetRequest


class RewardBuildTest(TestCase):
    def test_parallel_rewrites_preserve_candidate_order_and_deduplicate(self):
        pair = Barrier(2, timeout=2)
        responses = ("First", "second", "FIRST", "third")
        candidates = {
            int.from_bytes(sha256(f"123:input:{index}".encode()).digest()[:8], "big") >> 1: text
            for index, text in enumerate(responses)
        }

        def generate(prompt, *, seed, **kwargs):
            pair.wait()
            return candidates[seed]

        result = RewriteQuery(SimpleNamespace(generate=generate), max_concurrency=2).execute(
            "question", input_id="input", seed=123, count=4, temperature=0.7, max_new_tokens=48,
        )
        self.assertEqual(result.queries, ("First", "second", "third"))

    def test_openai_paces_requests_and_honors_rate_limit_cooldown(self):
        clock = 10.0
        request_times = []

        def advance(delay):
            nonlocal clock
            clock += delay

        def send(*args, **kwargs):
            request_times.append(clock)
            if len(request_times) == 1:
                raise HTTPError(
                    "", 429, "Rate limited", {"Retry-After": "3"},
                    BytesIO(b'{"error":{"code":"rate_limit_exceeded"}}'),
                )
            return BytesIO(b'{"choices":[{"message":{"content":"Query"}}]}')

        with (
            patch.object(openai_llm_adapter, "monotonic", side_effect=lambda: clock),
            patch.object(openai_llm_adapter, "sleep", side_effect=advance),
            patch.object(openai_llm_adapter, "uniform", return_value=0),
            patch.object(openai_llm_adapter, "urlopen", side_effect=send),
        ):
            model = openai_llm_adapter.OpenAILLMAdapter("test-key", requests_per_minute=60)
            self.assertEqual(model.generate("first request"), "Query")
            self.assertEqual(model.generate("next request"), "Query")
        self.assertEqual(request_times, [10.0, 13.0, 14.0])

    def test_tie_retention_keeps_first_rewrite_for_every_reward(self):
        rewriter = SimpleNamespace(execute=lambda *args, **kwargs: RewriteCandidates(
            "Prompt", ("first query", "second query")
        ))
        retrieval = SimpleNamespace(execute=lambda queries, **kwargs: [()] * len(queries))
        context = SimpleNamespace(execute=lambda matches, budget: None)
        expected_scores = {"r0": 1.0, "r1": 0.5, "r2": -0.1, "r3": 0.0}
        inputs = {
            reward: [RewardInput("q1", "c1", "Question", lambda _, score=score: score)]
            for reward, score in expected_scores.items()
        }
        for keep_tie in (False, True):
            results = BuildRewardDataset(
                rewriter, retrieval, context, RewardBuildSettings(keep_tied_rewrite=keep_tie)
            ).execute(inputs)
            for reward, score in expected_scores.items():
                with self.subTest(reward=reward, keep_tie=keep_tie):
                    result = results[reward]
                    self.assertEqual(result.summary()["kept_tied_rewrites"], int(keep_tie))
                    self.assertEqual(result.outcomes[0].tied_score, score)
                    if keep_tie:
                        self.assertEqual(result.examples[0].completion, "first query")
                    else:
                        self.assertEqual(result.outcomes[0].skip_reason, "all_scores_tied")

    def test_device_selection_prefers_cuda_then_mps_then_cpu(self):
        with patch.object(torch.cuda, 'is_available', return_value=True) as cuda, (
            patch.object(torch.backends.mps, 'is_available', return_value=True)
        ) as mps:
            self.assertEqual(resolve_device('auto'), 'cuda')
            mps.assert_not_called()
            cuda.return_value = False
            self.assertEqual(resolve_device('auto'), 'mps')
            self.assertEqual(resolve_device('cpu'), 'cpu')
            mps.return_value = False
            self.assertEqual(resolve_device('auto'), 'cpu')
            self.assertEqual(resolve_device('gpu'), 'cuda')
            self.assertEqual(resolve_device('mps'), 'mps')

    def test_mps_seed_applies_to_sampling_and_restores_rng_on_failure(self):
        # Stand in for the MPS generator so this also runs in the Linux image.
        generator = torch.Generator().manual_seed(91)
        initial = generator.get_state()
        cpu_initial = torch.random.get_rng_state()
        with (
            patch.object(torch.mps, 'get_rng_state', generator.get_state),
            patch.object(torch.mps, 'manual_seed', generator.manual_seed),
            patch.object(torch.mps, 'set_rng_state', generator.set_state),
        ):
            with _sampling_rng(torch.device('mps'), sample=True, seed=123):
                first = torch.rand(4, generator=generator)
            with self.assertRaisesRegex(RuntimeError, 'generation failed'):
                with _sampling_rng(torch.device('mps'), sample=True, seed=123):
                    torch.testing.assert_close(torch.rand(4, generator=generator), first)
                    raise RuntimeError('generation failed')
        self.assertTrue(torch.equal(generator.get_state(), initial))
        self.assertTrue(torch.equal(torch.random.get_rng_state(), cpu_initial))

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
            if prompt.startswith('Rewrite the input as one standalone search query'):
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

    def test_single_rewrite_uses_remote_r1_teacher_and_local_retrieved_reader(self):
        conversation = Conversation(
            'c1', ('Alice',), (Session(1, datetime(2025, 1, 1), (
                Turn('t1', 'Alice', 'Alice moved to Denver.'),
            )),),
        )
        partition = DatasetPartition(
            conversations=(conversation,),
            qa=(QA('q1', 'c1', 'Where did Alice move?', 'single_hop', evidence_turn_ids=('t1',)),),
        )
        local = SimpleNamespace(
            generate=Mock(return_value='Denver'),
            prompt_fits=Mock(side_effect=lambda prompt, **_: 'Alice moved to Denver.' not in prompt),
            count_tokens=lambda text: len(text.split()),
        )
        teacher = SimpleNamespace(generate=Mock(return_value='Denver'))
        rewriter = SimpleNamespace(generate=Mock(return_value='Where did Alice move?'))
        embedder = SimpleNamespace(embed_queries=lambda queries: [(1,)] * len(queries))
        store = SimpleNamespace(search=lambda *args, **kwargs: [
            SimpleNamespace(memory=SimpleNamespace(text='Denver', source_turn_ids=('t1',))),
        ])
        build = BuildRewardDatasets(local, local, local, embedder, store)

        def run(keep_single):
            return build.execute(
                partition, ['r1'],
                RewardBuildSettings(candidates=2, keep_single_rewrite=keep_single),
                rewrite_model=rewriter, r1_teacher_model=teacher,
            )['r1']

        self.assertEqual(run(False).outcomes[0].skip_reason, 'too_few_distinct_rewrites')
        teacher.generate.assert_not_called()
        result = run(True)
        self.assertEqual(result.summary()['kept_single_rewrites'], 1)
        self.assertEqual(result.outcomes[0].winning_score, 1.0)
        for call in rewriter.generate.call_args_list:
            self.assertIn('ranked by semantic similarity to individual conversation', call.args[0])
            self.assertIn('short, natural statements a speaker might use', call.args[0])
            self.assertIn('Bridge wording gaps', call.args[0])
            self.assertIn('Use only facts from the input.', call.args[0])
            self.assertTrue(call.args[0].endswith('Where did Alice move?\n\nQuery:'))
        self.assertTrue(result.examples[0].prompt.endswith('Where did Alice move?\nQuery:'))
        self.assertTrue(result.examples[0].prompt.startswith('Rewrite the input as one standalone search query'))
        teacher.generate.assert_called_once()
        local.generate.assert_called_once()
        self.assertIn('Alice moved to Denver.', teacher.generate.call_args.args[0])
        self.assertNotIn('Alice moved to Denver.', local.generate.call_args.args[0])
        teacher.generate.side_effect = ContextWindowExceeded('Too long')
        self.assertEqual(run(True).outcomes[0].skip_reason, 'full_history_too_long')

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
            rewrite_generator={"provider": "local", "model_id": "test/model"},
            reward_pipeline_version=2, settings={}, results=[], elapsed_seconds=0,
        )
        with (
            TestClient(app) as client,
            patch.object(routes, "_prepare_build", return_value=(None, RewardBuildSettings())),
            patch.object(routes, "require_indexed_partition"),
        ):
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

            release_build = Event()

            def build_after_discovery(*args):
                if not release_build.wait(timeout=5):
                    raise TimeoutError("Build settings were not checked in time.")
                return response

            with patch.object(routes, "_build", side_effect=build_after_discovery) as build:
                started = client.post("/rewards/builds", json={
                    "prepared_id": "prepared",
                    "all_benchmark_seeds": True,
                    "rewrite_generator": "openai",
                    "r1_teacher": "local",
                    "keep_all_one_ties": True,
                    "keep_single_rewrite": True,
                    "keep_tied_rewrite": True,
                })
                self.assertEqual(started.status_code, 202, started.text)
                initial = started.json()
                self.assertEqual(initial["seeds"], [123, 456, 789])
                job = app.state.reward_build_job
                try:
                    active = client.get("/rewards/builds").json()["job"]
                    self.assertEqual(active["id"], initial["id"])
                    expected_config = {
                        "max_inputs_per_reward": None,
                        "rewrite_generator": "openai",
                        "r1_teacher": "local",
                        "keep_all_one_ties": True,
                        "keep_single_rewrite": True,
                        "keep_tied_rewrite": True,
                    }
                    self.assertEqual(initial["configuration"], expected_config)
                    self.assertEqual(active["configuration"], expected_config)
                finally:
                    release_build.set()
                job.future.result(timeout=3)
                self.assertEqual(job.status().completed_seeds, (123, 456, 789))
                self.assertEqual(job.status().configuration.model_dump(), expected_config)
                self.assertEqual([call.args[3].seed for call in build.call_args_list], [123, 456, 789])
                for call in build.call_args_list:
                    self.assertEqual(call.args[0].rewards, ["r0", "r1", "r2", "r3"])
                    self.assertEqual(call.args[0].rewrite_generator, "openai")
                    self.assertTrue(call.args[0].keep_all_one_ties)
                    self.assertTrue(call.args[0].keep_single_rewrite)
                    self.assertTrue(call.args[0].keep_tied_rewrite)
                    self.assertIsNone(call.args[0].max_inputs_per_reward)
