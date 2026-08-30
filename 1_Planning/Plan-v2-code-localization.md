# Project Plan — Learning to Query: Outcome-Supervised Search Formulation for Code Issue Localization

CSCI 6970 MS Course Project / CSCI 5230 NLP & GenAI Term Project · Ronald Yu · Fall 2026
Framing settled 2026-08-30. Supersedes the conversational-memory framing preserved in `Plan-v1-conversational-memory.md`.

This document is written against the four MS proposal criteria — scope specificity, significant research *and* implementation, demonstrated MS-level breadth, and mastery of subject — and secondarily against CSCI 5230's requirement of a novel solution demonstrated as a proof-of-concept prototype. Novelty is claimed here, but modestly and in one place; the project does not depend on it.

---

## 1. Short statement (proposal-length, ~170 words)

> When a coding assistant is asked to fix a bug, its first real decision is what to search for. The bug report is written in user vocabulary — "the app hangs on large uploads" — while the code that must change is written in identifier vocabulary — `chunk_size`, `MultipartUploadHandler`. Bridging that gap is a language problem, and current systems solve it by handing the whole report to a frontier model and letting it improvise a search. This project asks what the right *target representation* for that translation is, and whether a small model can be trained to produce it without any reference queries.
>
> The method manufactures its own supervision: candidate searches are sampled from a base model, executed against the repository, and scored by whether the files that actually required modification are recovered within a fixed context budget. Winning candidates become training data. The same pipeline is run against three output languages — lexical patterns, natural-language queries, and hypothetical code — so that the target representation becomes the experimental variable rather than an assumption.

---

## 2. Scope

**In scope.** A single task (file-level localization for software issues), a single dataset (SWE-bench), a single supervision signal (retrieval outcome against the gold patch), one training method (LoRA rejection-sampling SFT) applied across three output languages, and one evaluation axis (recall under a context budget). Two base-model families, so the method is shown to be model-agnostic.

**Explicitly out of scope**, and stated as such so the boundary is visible to a reader:

- **Patch generation.** The project stops at localization. Whether a model can fix the bug once the file is found is a separate problem with separate infrastructure.
- **Multi-turn agent loops.** Search is evaluated single-shot. Iterative search-read-research is named as future work and given one paragraph, not one experiment.
- **Conversational memory.** The observation that motivated this project — coding harnesses let the model compose its own searches while conversational memory systems retrieve mechanically from the user's message — appears in the introduction and the discussion. It is not a second experimental domain. See `Plan-v1-conversational-memory.md` for the abandoned version.
- **Retriever training.** The encoder is frozen. The intervention is the query, never the index.
- **Reranking.** Excluded to keep the causal chain from query to outcome unbroken.

**The controlling design constraint.** Everything downstream of query generation is deterministic: fixed encoder, fixed chunking, fixed repository snapshot, fixed budget accounting, no LLM anywhere at retrieval time. The query generator is the only moving part, so every measured difference is attributable to it by construction. This is the single most important methodological decision in the project and it should be defended explicitly in the report.

---

## 3. Problem

Retrieval-augmented systems for code face an asymmetry that retrieval over prose does not. A natural-language issue and the source file that must change share very little surface vocabulary. Dense retrieval is supposed to absorb this, but it is handed a poor query: SWE-bench issue texts routinely include stack traces, version tables, reproduction transcripts, and conversational back-and-forth, and most sentence encoders truncate at 256 or 512 tokens. A substantial fraction of issues therefore cannot be encoded at all without discarding material, and what survives truncation is whatever happened to appear first rather than whatever was diagnostic.

Production coding assistants sidestep this by not using dense retrieval at all. They expose lexical search — `grep`, `glob` — as tools and let a frontier model compose the pattern, inspect the output, and search again. This works, and it is expensive: it spends frontier-model calls on a subproblem that is arguably a translation task, and it makes search quality an emergent property of a prompt rather than something measured or trained.

The question this project takes up is whether search formulation can be separated out, trained explicitly at small scale, and — the part that is genuinely open — what output language it should be trained to produce. Lexical patterns, natural-language queries, and hypothetical code fragments are three different translations of the same issue, they route to different retrieval machinery, and they plausibly fail on different issues. No reference queries exist for any of them, which is why the supervision has to come from outcome rather than from imitation.

**Stakeholders.** Anyone building or operating a coding assistant under a cost or latency budget: search formulation is currently a frontier-model call on every turn, and it is the component most plausibly delegable to a small local model. Secondarily, anyone maintaining a large repository whose issue tracker is the entry point for new contributors.

---

## 4. What gets built (implementation)

The deliverable is a working localization harness, not a notebook. Five components, each independently testable:

1. **Repository snapshot manager.** Checks out each SWE-bench instance's repository at `base_commit`, enumerates source files, and caches the tree. Guarantees that no search ever sees post-fix code — the most obvious way to accidentally leak the answer.
2. **Index builder.** Chunks source files under a fixed policy, embeds with a frozen sentence encoder, and persists vectors. Cached across runs; the index is built once per repository snapshot, not once per experiment.
3. **Search executors.** A lexical executor wrapping `ripgrep` with timeouts and pathological-pattern guards, and a dense executor doing cosine similarity over the persisted index. Both return results in a common format so the scorer is agnostic to which produced them.
4. **Budget accountant and scorer.** Truncates any result set to a line budget *B*, computes file-level recall against the gold patch's modified files, and records precision, rank of first gold file, and the realized line count. This is the component that makes lexical and dense results comparable at all.
5. **Candidate factory and training pipeline.** Samples *k* candidate queries per issue per output language under nucleus sampling, executes and scores each, assembles the surviving candidates into an SFT corpus, and runs LoRA fine-tuning. Optionally emits (winner, loser) pairs for preference optimization.

Engineering that is not incidental: repository checkout is slow and must be parallelized and cached; embedding indices for a dozen large Python repositories must be built once and reused; candidate scoring is the throughput bottleneck and determines whether *k* can be 8 or 32; and every result must be reproducible from a seed and a config file, because the analysis depends on comparing runs that differ in exactly one variable.

---

## 5. What gets measured (research)

**Primary metric: recall under a context budget.** For a budget *B* (in lines returned), what fraction of the files modified by the gold patch appear in the result set? Reported as a curve over *B* ∈ {200, 500, 1000, 2000, 5000}, never as a single number. The budget framing is what makes the metric faithful to the deployment setting — a search returning 4,000 lines is useless regardless of its recall, because the results do not fit in the context the search was meant to fill — and it is the only axis on which a `ripgrep` pattern set and a dense top-*k* can be compared honestly.

**Secondary metrics.** Precision, mean reciprocal rank of the first gold file, fraction of instances where *all* gold files are recovered, and realized-versus-allotted budget utilization.

**Research questions.** Ordered by how much of the project survives if the answer is boring:

1. Which output language best supports issue localization — lexical patterns, natural-language queries, or hypothetical code — and does the answer change with budget?
2. Does outcome-supervised fine-tuning of a 3–4B model close the gap to a prompted 7–8B model on this task?
3. Do the three output languages fail on **disjoint** issues? If so, what does an oracle best-of-three router upper-bound, and is that headroom large enough to justify a learned router?
4. Which properties of a generated query predict retrieval success — identifier density, length, overlap with the issue's own vocabulary, specificity — as distinct from properties that make a query look reasonable?
5. Does encoder truncation account for a measurable share of dense retrieval's failures, and does rewriting recover it?

Questions 3, 4, and 5 are answerable from data that questions 1 and 2 generate as a byproduct. That is deliberate: **the analysis half of the project stands regardless of how the training half turns out**, and the report is pre-registered to that effect.

### Baseline ladder

Encoder, chunking, repository snapshot, and budget accounting held fixed across every rung.

| # | Rung | Purpose |
|---|---|---|
| 0 | Random file selection under budget | Floor |
| 1 | BM25 over raw issue text | Lexical baseline without a model |
| 2 | Dense retrieval, raw issue embedded as-is | The status quo, and the thing rewriting must beat |
| 3 | Dense retrieval, issue truncated to first *N* tokens | Isolates truncation as a cause |
| 4 | From-scratch seq2seq query generator | See §6 — instantiates the pre-pretraining approach |
| 5 | Prompted small model, each of three output languages | Untrained status quo per arm |
| 6 | Prompted 7–8B model, each of three output languages | Target to close the gap to |
| 7 | **Fine-tuned small model, each of three output languages** | The contribution |
| 8 | Oracle query built from gold patch identifiers | Ceiling per arm — what *any* query could achieve |

Rung 8 is the most important row in the table and is built first. It bounds the entire project: if the oracle for an arm is weak, that arm is dropped in week 2 rather than in October.

---

## 6. Grounding

### MS-level breadth (proposal criterion 3)

| Area | Where it is exercised |
|---|---|
| Machine learning / deep learning | Parameter-efficient fine-tuning, optimization under an 8 GB VRAM budget, sampling temperature and its effect on candidate diversity |
| Natural language processing | The entire task: conditional generation, encoder representations, evaluation methodology |
| Information retrieval | BM25, dense retrieval, recall/precision/MRR, budget-constrained evaluation, index construction |
| Software engineering and systems | A five-component reproducible harness, snapshot management, caching, parallel execution, config-driven experiment tracking |
| Data engineering | Construction of a training corpus that does not exist a priori, from sampling through scoring through filtering |
| Experimental design and statistics | Frozen controls, single-variable ablations, seed variance, curves rather than points, pre-registered analyses |

### CSCI 5230 course units

| Unit | Use |
|---|---|
| **Word Vectors; Evaluation Methods for Unsupervised Word Embeddings** (Wk 2–3) | Dense retrieval over code chunks is one of three arms. The intrinsic-versus-extrinsic evaluation reading is the direct methodological ancestor of research question 4. Vocabulary mismatch between issue prose and code identifiers is a word-sense problem in the vocabulary of Lecture 2. |
| **Language Models and RNNs; Seq2Seq and Attention; BLEU** (Wk 6–8) | Query generation is conditional sequence generation with a choice of target language, which is a machine-translation question. The BLEU reading motivates the refusal to score generated queries by similarity to any reference. Rung 4 of the ladder is an LSTM-with-attention seq2seq trained from scratch — the pre-pretraining approach, implemented rather than cited. |
| **Self-Attention and Transformers** (Wk 9–10) | All base models are decoder-only transformers; the encoder is a bidirectional transformer with a hard input-length limit, which is the mechanical cause investigated in research question 5. |
| **Pretraining and Transfer Learning** (Wk 11–12) | The core method. Rung 4 versus rung 7 is a controlled demonstration of what pretraining buys, run on the same task with the same data. |
| **Prompting and RLHF** (Wk 13) | Prompted models are rungs 5 and 6. Rejection-sampling SFT over outcome-scored candidates is the method of *Learning to Summarize from Human Feedback* with a retrieval outcome substituted for the human preference signal. Optional DPO over (winner, loser) pairs. |
| **Natural Language Generation** (Wk 16) | *The Curious Case of Neural Text Degeneration* governs the decoding strategy used to sample diverse candidates — the diversity of that sample is what makes rejection sampling work at all. *How NOT To Evaluate Your Dialogue System* is the justification for extrinsic evaluation throughout. |

### Novelty (CSCI 5230)

Query rewriting for retrieval is established work — Rewrite-Retrieve-Read trains a rewriter against downstream reward, HyDE generates a hypothetical document to embed, doc2query runs the transformation at index time. The novel element claimed here is narrow and specific: **the target representation is treated as an experimental variable rather than a design assumption**, with three output languages trained by one method, on one dataset, under one budget-constrained metric. No head-to-head comparison of lexical, natural-language, and code-like query targets for issue localization appears in the literature reviewed so far. Verification of that claim is a week-1 task, and if it fails the project loses one paragraph and no experiments.

---

## 7. Week-1 go/no-go checks

Run before any training code is written. Each is an afternoon.

1. **Encoder truncation rate.** What fraction of SWE-bench issue texts exceed the encoder's input limit, and how much of the diagnostic content sits past the cut? If the rate is negligible, research question 5 is dropped and the truncation ablation (rung 3) comes out of the ladder.
2. **Oracle ceiling per arm (rung 8).** Identifiers extracted directly from gold patch hunks, used as lexical patterns and as dense queries. If an arm's oracle cannot recover gold files under a reasonable budget, that arm is not viable and is dropped.
3. **Baseline gap.** Rung 1 versus rung 2 on raw issues. If dense already saturates, the interesting work is lexical; if BM25 already saturates, the interesting work is dense. Either result redirects effort in week 1 rather than week 10.
4. **Prior work check.** Confirm no published head-to-head of query target representations for issue localization, and read Rewrite-Retrieve-Read closely enough to state precisely how this differs.

---

## 8. Schedule

| Week | Dates | Milestone |
|---|---|---|
| 1 | Aug 31 – Sep 6 | **MS proposal submitted Aug 31.** Go/no-go checks 1–4. Arms confirmed or dropped. |
| 2 | Sep 7 – 13 | Harness components 1–2: snapshot manager, index builder. |
| 3 | Sep 14 – 20 | Harness components 3–4: search executors, budget accountant, scorer. Rungs 0–3 measured and frozen. |
| 4 | Sep 21 – 27 | **CSCI 5230 proposal due Sep 25.** Candidate factory built. Rungs 5–6 (prompted, all three arms). |
| 5–6 | Sep 28 – Oct 11 | Candidate scoring at scale; training corpus assembled. LoRA SFT, arm 1. |
| 7–8 | Oct 12 – 25 | LoRA SFT, arms 2 and 3. First full budget curves. |
| 9 | Oct 26 – Nov 1 | Rung 4 (from-scratch seq2seq). Second base-model family. |
| 10 | Nov 2 – 8 | Full evaluation sweep, seed variance, curves finalized. |
| 11 | Nov 9 – 15 | Analysis: disjoint failure sets, oracle router, query-property regression (RQ 3–4). |
| 12 | Nov 16 – 22 | Report drafting against the MS rubric's six sections. |
| 13 | Nov 23 – 29 | Buffer, revision, bibliography. |
| — | **Nov 30** | **MS final report due.** |
| — | Dec 1 – 4 | CSCI 5230 report adaptation and presentation. |

Weeks 9 and 13 are deliberate slack. The second model family and the from-scratch baseline are the first things cut if earlier weeks overrun; neither is load-bearing for the primary result.

---

## 9. Deliverables

- **Localization harness** — five components, config-driven, reproducible from seed.
- **Training pipeline** — candidate sampling, outcome scoring, corpus assembly, LoRA fine-tuning, three output languages, two model families.
- **Result set** — budget curves for nine ladder rungs across three arms, with seed variance.
- **Analysis** — failure-set disjointness, oracle router bound, query-property regression.
- **Written report** structured to the MS rubric: introduction and questions; analysis of ideas; organization; research and implementation quality; language; bibliography.
- **CSCI 5230 presentation** — slides and video, due Dec 4.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Oracle ceiling low for an arm | Detected week 1 by check 2; arm dropped, remaining arms absorb the time |
| Candidate scoring too slow to support useful *k* | Reduce *k*, restrict to SWE-bench Lite (~300 instances) for training and reserve the full set for evaluation |
| Fine-tuned model fails to beat prompted baselines | Rungs 0–6 and 8 explain why; research questions 3–5 are unaffected. Pre-register this in the proposal. |
| VRAM exhaustion on 8 GB | 3–4B base models with LoRA and 4-bit quantization; the 7–8B rung is inference-only |
| Repository checkout and indexing overhead | Built and cached in weeks 2–3, before anything depends on it |
| Scope creep back toward patch generation or agent loops | §2 exists to be re-read in October |

---

## 11. Deadlines

| Date | Deliverable | Course |
|---|---|---|
| Mon Aug 24 | Declare project | CSCI 6970 — **passed** |
| **Mon Aug 31, 11:59pm MT** | **Proposal** | CSCI 6970 |
| Fri Sep 25 | Proposal | CSCI 5230 |
| **Mon Nov 30** | Final report | CSCI 6970 |
| Fri Dec 4 | Final report + presentation | CSCI 5230 |

Hard deadlines. No late work, no resubmission, no exceptions.

---

## 12. Open action items

1. **Notify Banaei-Kashani of the topic change.** The Aug 24 declaration named the conversational-memory summarizer project. The method is unchanged — outcome-derived supervision, no reference targets, extrinsic evaluation — but the domain is not. One paragraph by email before the proposal lands is better than a surprise on Aug 31.
2. **Get written authorization for dual submission.** The CSCI 5230 syllabus treats unauthorized multiple submission as an honor code violation. Still outstanding.
3. **Pull `MS-Course-Project-template.docx` from Canvas** and draft the proposal into it. The evaluation form is already in `0_Info/MS_Course_Project/`; the template is not.
4. **Take the pre-proposal office-hours meeting** — front desk 303-315-1408, or ComputerScience@ucdenver.edu. Office hours are Mondays 5:00–8:30pm and Thursdays 6:00–7:30pm, by appointment.

---

## 13. Sources

**Primary method lineage**
- [Learning to summarize from human feedback](https://arxiv.org/abs/2009.01325) — the rejection-sampling / preference-optimization method, course reading Wk 13
- [Query Rewriting for Retrieval-Augmented Large Language Models (Rewrite-Retrieve-Read)](https://arxiv.org/abs/2305.14283) — trained rewriter with downstream reward; nearest prior work
- [Precise Zero-Shot Dense Retrieval without Relevance Labels (HyDE)](https://arxiv.org/abs/2212.10496) — hypothetical-document generation, motivates the third arm
- [Document Expansion by Query Prediction (doc2query)](https://arxiv.org/abs/1904.08375) — the index-time inverse

**Task and data**
- [SWE-bench: Can Language Models Resolve Real-World GitHub Issues?](https://arxiv.org/abs/2310.06770) — dataset, gold patches, `base_commit` snapshots
- [Agentless: Demystifying LLM-based Software Engineering Agents](https://arxiv.org/abs/2407.01489) — localization treated as a separable stage

**Course readings load-bearing in the design**
- [The Curious Case of Neural Text Degeneration](https://arxiv.org/abs/1904.09751) — Wk 16; governs candidate sampling
- [How NOT To Evaluate Your Dialogue System](https://arxiv.org/abs/1603.08023) — Wk 16; justifies extrinsic evaluation
- [BLEU: a Method for Automatic Evaluation of Machine Translation](https://aclanthology.org/P02-1040.pdf) — Wk 8; the metric being argued against
- [Evaluation methods for unsupervised word embeddings](https://aclanthology.org/D15-1036/) — Wk 3; intrinsic vs. extrinsic, ancestor of RQ 4
- [Finetuned Language Models Are Zero-Shot Learners](https://arxiv.org/abs/2109.01652) — Wk 13
- [Sequence to Sequence Learning with Neural Networks](https://arxiv.org/pdf/1409.3215.pdf) — Wk 8; rung 4
- [Neural Machine Translation by Jointly Learning to Align and Translate](https://arxiv.org/pdf/1409.0473.pdf) — Wk 8; rung 4

**Retained from v1 for the motivation section**
- [RAPTOR: Recursive Abstractive Processing for Tree-Organized Retrieval](https://arxiv.org/html/2401.18059v1) — mechanical retrieval from the user's query, no LLM at query time
- [MemGPT: Towards LLMs as Operating Systems](https://arxiv.org/abs/2310.08560) — the counterexample; model-issued memory search via function calls
