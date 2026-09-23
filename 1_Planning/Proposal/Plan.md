# Project Plan — Training Memory Query Rewriters Without Evidence Labels

CSCI 6970 MS Course Project / CSCI 5230 NLP & GenAI Term Project · Ronald Yu · Fall 2026
Framing settled 2026-08-30. Earlier versions: `Plan-v1-conversational-memory.md` (summarizer fine-tuning), `Plan-v2-code-localization.md` (SWE-bench issue-to-query).

Written against the four MS proposal criteria: scope, research + implementation, MS-level breadth, mastery.

---

## 1. Short statement

> Conversational memory systems search using the user's message. That message is often a poor search key. Ask an assistant "should I bring a jacket to dinner tomorrow?" and the memories that answer it are "I get cold easily," said three months ago, and "dinner's on the rooftop patio," said yesterday. Neither is close to "jacket" in embedding space.
>
> Recent work fixes this by training a model to rewrite the query before searching. The best current system, PPRO, rewards the rewriter using annotated evidence turns from a benchmark. Real deployments do not have those annotations, and the paper names this as a limitation.
>
> This project trains a memory query rewriter with no evidence labels at all. The reward is manufactured from the conversation itself. Three ways of doing that are built and compared, evaluated against LoCoMo's annotations that the training never sees. The result is a measurement: how much of a supervised rewriter's gain can be recovered without labels.

---

## 2. Scope

**In scope.** One task (query formulation for memory retrieval), one evaluation benchmark (LoCoMo, with LongMemEval-S if time allows), one training method (rejection-sampling SFT with LoRA), and three label-free reward functions compared head to head. One base model family, with a second if the schedule holds.

**Out of scope**, stated so the boundary is visible:

- **Memory construction.** How memories are extracted, summarized, or indexed is frozen. This project changes only the query. The write path was the subject of v1 and is abandoned.
- **Reranking.** Excluded so the path from query to retrieved set stays unbroken.
- **Retriever training.** The encoder is frozen. The intervention is the query, never the index.
- **Reinforcement learning.** PPRO used GRPO. This project uses rejection-sampling SFT, which fits the hardware and is simpler to debug. The difference in method is reported as a finding, not hidden.
- **Multi-query decomposition.** Interesting and not covered by PPRO, but it is a second contribution and this project has one. Named in future work.
- **Code retrieval.** See `Plan-v2-code-localization.md`. Dropped.

**The controlling design rule.** Gold evidence annotations are used at **evaluation time only**. Nothing in the training loop ever sees them. Everything except the rewriter is frozen — memory construction, encoder, reader, *k*, budget — so every measured difference comes from the query. These two rules are what the project is; they should be stated in the proposal and defended in the report.

---

## 3. Problem

Memory systems retrieve using the user's message, embedded as-is. That works when the message describes what needs to be found. Often it doesn't. Questions use different words than the memories that answer them, refer to things by pronoun, or need two separate facts that no single embedding can ask for at once.

Fixing the query rather than the retriever is an established idea. RRR and CONQRR trained query rewriters years ago. What is new is applying it to long-term memory: PPRO (2026) trains a rewriter with GRPO, keeping the memory bank, encoder, and answer model frozen, and reports gains on LoCoMo and LongMemEval-S.

PPRO's reward is the problem. It scores a rewritten query by F1 against ground-truth evidence turns, plus BLEU against a reference answer. Both come from benchmark annotations. A deployed assistant has a user's conversation history and nothing else — no labeled evidence, no reference answers. The method that works in the paper cannot be trained on the data it is meant to serve. The authors list this explicitly as unaddressed.

Work removing that dependency exists, but in a different setting. ConvSearch-R1 and RL-QR train rewriters without rewrite supervision, and AdaQR computes reward from conversation turns alone using the marginal probability of answers. All three retrieve passages from an external corpus. Long-term memory retrieves from the user's own history, which is a different store with different failure modes: it is small enough to fit in a context window, it has no canonical documents, and its content was produced by the same person now asking about it.

That last property is what this project exploits. Because a user's history is small, it can be read in full offline even though it cannot be read in full at serving time. That makes it possible to build a teacher signal from the conversation itself, and to ask a question nobody has answered: **how much of a supervised rewriter's benefit survives when the labels are removed?**

**Stakeholders.** Anyone deploying a memory system on real user data, where benchmark annotations do not exist and cannot be produced at scale. Also anyone running memory retrieval on-device or under a cost limit, where the rewriter must be a small local model rather than a frontier API call.

---

## 4. What gets built

Four components, each testable on its own.

1. **Memory pipeline.** Builds the memory store from a conversation — segmentation, embedding with a frozen encoder, persistence. Built once, reused everywhere. Follows a published configuration rather than inventing one, so the baseline is recognizable.
2. **Retrieval and budget harness.** Runs a query against the store, returns memories under a fixed token budget, and scores the result. Records recall of gold evidence turns (evaluation only), realized budget, and rank of first gold memory.
3. **Reward bank.** Three interchangeable label-free scorers behind one interface, so swapping the reward is a config change rather than a rewrite. This is the core of the project and the part the report is about.
4. **Candidate factory and training loop.** Samples *k* candidate rewrites per question under nucleus sampling, scores each with the selected reward, assembles winners into an SFT corpus, and runs LoRA fine-tuning. Optionally emits (winner, loser) pairs for DPO.

Engineering that is not incidental: candidate scoring is the throughput bottleneck and determines whether *k* can be 8 or 32; reward R1 requires a long-context generation per candidate and needs aggressive caching; every run must be reproducible from a seed and a config file, because the whole analysis is comparing runs that differ in one variable.

---

## 5. The three rewards

Each scores a candidate rewritten query without any annotation.

**R1 — Full-context teacher.** LoCoMo conversations average about 9K tokens, so the whole history fits in a modern context window. Answer the question twice: once from the memories the candidate query retrieved, once from the entire conversation. Reward is agreement between the two answers. The full-context answer is a free teacher. Closest prior work is AdaQR, which uses the marginal probability of answers in corpus search; the difference here is that the teacher sees the complete store, which is only possible because personal history is small.

**R2 — Masked-turn prediction.** Hide a turn from the conversation. Formulate a query from the turns before it. Reward is how much the retrieved memories reduce the perplexity of the hidden turn. No question, no answer, no labels — the conversation supervises itself. This is the most self-contained of the three and the closest to a pretraining objective.

**R3 — Synthetic evidence.** Pick a turn, generate a question that turn answers, and record the pair. That manufactures (question, evidence) supervision for free. Closest prior work is RL-QR's index-aligned synthetic queries. Known weakness, and the reason it is worth including: generated questions tend to reuse their source turn's wording, which is the easy case a rewriter is least needed for. Whether that shows up as a measurable bias is testable.

**R0 — Supervised ceiling.** PPRO's reward: F1 against gold evidence turns. Trained the same way as the others, with the same sampler and the same budget, so it is the upper bound rather than a competitor. This is the number every label-free reward is reported as a fraction of.

---

## 6. What gets measured

**Primary metric.** Recall of gold evidence turns under a fixed context budget, reported as a curve over budgets rather than a single point. A retrieval that returns everything is useless regardless of recall, and the budget is what keeps a degenerate query from winning.

**Secondary metrics.** Downstream QA score with a frozen reader; rank of first gold memory; realized budget use.

**Always reported per LoCoMo category** — single-hop, multi-hop, temporal, open-domain — never as one average. Deltas under about two points are treated as noise, given the published disputes over LoCoMo numbers.

**Research questions**, ordered so the later ones survive if the earlier ones come out flat:

1. How much of R0's gain does each label-free reward recover?
2. Do the three rewards produce different queries, and do they fail on different questions? What does an oracle best-of-three upper-bound?
3. Does the ranking of rewards change by question category? Prediction: R1 leads on multi-hop, R2 on single-hop, R3 weakest where wording differs most from the evidence.
4. Does R3's lexical-leakage weakness appear as predicted, measured as overlap between the synthetic question and its source turn?
5. How close does rejection-sampling SFT get to PPRO's reported GRPO gains?

Questions 2 through 4 are answered from data that question 1 produces anyway. The analysis stands regardless of how the training turns out, and the proposal says so.

### Baseline ladder

Memory construction, encoder, reader, *k*, and budget frozen across every rung.

| # | Rung | Purpose |
|---|---|---|
| 0 | Raw user message, embedded as-is | The status quo in nearly every memory system |
| 1 | BM25 on the raw message | Lexical floor |
| 2 | Prompted rewrite, small model | Untrained rewriting |
| 3 | Prompted rewrite, larger model | What an API call buys |
| 4 | **Trained on R1** | Contribution |
| 5 | **Trained on R2** | Contribution |
| 6 | **Trained on R3** | Contribution |
| 7 | Trained on R0 (gold labels) | Supervised ceiling |
| 8 | Oracle query built from gold evidence turns | Ceiling on any query |

Rung 8 is built first. If it does not clear rung 0 by a wide margin, query rewriting cannot help in this setup and the project needs to know in week 1.

### A note on training data

The label-free rewards need no annotated questions, and R2 needs no questions at all. Training data can therefore be any multi-session conversation corpus, with LoCoMo held out entirely for evaluation. This is a real advantage of the label-free framing and should be stated as one: the method scales to unlabeled conversation data by construction, which is the whole argument for building it.

---

## 7. Week-1 go/no-go

Each is an afternoon. Run before writing training code.

1. **Headroom.** How often does the raw message already retrieve the gold evidence turns? If it is near-saturated overall, restrict the project to multi-hop and temporal categories and say so.
2. **Oracle ceiling (rung 8).** Query built directly from gold evidence turns. Bounds everything.
3. **Reward sanity.** On a small sample, do R1/R2/R3 rank known-good queries above known-bad ones? A reward that cannot separate the oracle from the raw message will not train anything.
4. **Confirm the gap.** Verify no published work trains a memory query rewriter without evidence labels. Nearest neighbors as of 2026-08-30: PPRO (memory, supervised), ConvSearch-R1 / RL-QR / AdaQR (label-free, corpus search), Active Memory Navigation (memory, decomposition, uses gold evidence).

Check 3 is the one that decides the project. If none of the rewards can separate good queries from bad, the reward bank needs redesign before anything else happens.

---

## 8. Schedule

| Week | Dates | Milestone |
|---|---|---|
| 1 | Aug 31 – Sep 6 | **MS proposal due Aug 31.** Go/no-go checks 1–4. |
| 2 | Sep 7 – 13 | Memory pipeline; LoCoMo loading; rungs 0–1 measured and frozen. |
| 3 | Sep 14 – 20 | Retrieval and budget harness; budget curves working; rungs 2–3. |
| 4 | Sep 21 – 27 | **CSCI 5230 proposal due Sep 25.** Reward bank: R1, R2, R3 implemented behind one interface. |
| 5–6 | Sep 28 – Oct 11 | Candidate factory; scoring at scale; first SFT run (R1). |
| 7–8 | Oct 12 – 25 | SFT runs for R2 and R3. First full comparison. |
| 9 | Oct 26 – Nov 1 | R0 supervised ceiling. Second base model if on schedule. |
| 10 | Nov 2 – 8 | Full sweep, seed variance, per-category breakdown. |
| 11 | Nov 9 – 15 | Analysis: RQ 2–4, oracle best-of-three, leakage measurement. |
| 12 | Nov 16 – 22 | Report drafting. |
| 13 | Nov 23 – 29 | Buffer and revision. |
| — | **Nov 30** | **MS final report due.** |
| — | Dec 1 – 4 | CSCI 5230 report and presentation. |

Weeks 9 and 13 are slack. The second base model and LongMemEval-S are the first things cut.

---

## 9. Grounding

### MS-level breadth (criterion 3)

| Area | Where it is exercised |
|---|---|
| Machine learning | LoRA fine-tuning under an 8GB budget; sampling temperature and candidate diversity; reward design |
| NLP | Query generation, encoder representations, perplexity as a signal, evaluation methodology |
| Information retrieval | Dense retrieval, BM25, recall and rank metrics, budget-constrained evaluation |
| Software engineering | A four-component harness, config-driven, reproducible from seed, with caching |
| Data engineering | Building a training corpus that does not exist, from sampling through scoring through filtering |
| Experimental design | Frozen controls, single-variable ablations, seed variance, curves over points, pre-registered analyses |

### CSCI 5230 course units

| Unit | Use |
|---|---|
| **Word Vectors; Evaluation of Word Embeddings** (Wk 2–3) | Dense retrieval over memories is the retrieval mechanism. The intrinsic-vs-extrinsic reading is the direct ancestor of the whole design: rewrites are judged by what they retrieve, never by how they read. |
| **Language Models and RNNs** (Wk 5–6) | R2 uses perplexity of a held-out turn as its reward. This is a language-modeling objective used as a retrieval signal. |
| **Seq2Seq and Attention; BLEU** (Wk 7–8) | Query rewriting is conditional generation. PPRO's reward uses BLEU against reference answers; the BLEU reading is why this project does not. |
| **Self-Attention and Transformers** (Wk 9–10) | Base models are decoder-only transformers; the encoder is bidirectional with a hard input limit, which is part of why raw-message retrieval fails. |
| **Pretraining and Transfer Learning** (Wk 11–12) | The core method is LoRA transfer of a pretrained model to a narrow task. R2 is a pretraining-style self-supervised objective repurposed as reward. |
| **Prompting and RLHF** (Wk 13) | Rungs 2–3 are prompted baselines. Rejection-sampling SFT over scored candidates is the method of *Learning to Summarize from Human Feedback* with a manufactured signal replacing human preference. Optional DPO. |
| **Natural Language Generation** (Wk 16) | *The Curious Case of Neural Text Degeneration* governs candidate sampling — diversity there is what makes rejection sampling work. *How NOT To Evaluate Your Dialogue System* justifies extrinsic evaluation throughout. |

### Position against prior work (CSCI 5230 "novel solution")

The claim is narrow and precise. Trained query rewriting exists (RRR, CONQRR). Trained rewriting for long-term memory exists and is supervised (PPRO). Label-free rewriter training exists but in corpus search, not personal memory (ConvSearch-R1, RL-QR, AdaQR). Trained decomposition for memory exists and uses gold evidence (Active Memory Navigation). **What is absent is the intersection: training a memory query rewriter with no evidence labels, and comparing the label-free signals that make it possible.** PPRO names this as an open limitation.

This is a combination of two established lines rather than a new idea, and the report should say so. Stating the delta precisely is worth more than an inflated novelty claim.

---

## 10. Deliverables

- Working memory query-rewriting harness, four components, reproducible from config.
- Reward bank with three label-free signals plus the supervised ceiling.
- Training pipeline: candidate sampling, scoring, corpus assembly, LoRA fine-tuning.
- Results: budget curves for nine ladder rungs, per LoCoMo category, with seed variance.
- Analysis: reward comparison, failure-set overlap, oracle best-of-three, leakage measurement.
- Written report to the MS rubric's six sections.
- CSCI 5230 presentation, due Dec 4.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| No headroom over the raw message | Detected week 1 by check 1; scope narrows to multi-hop and temporal |
| A reward cannot separate good queries from bad | Detected week 1 by check 3; redesign before training code exists |
| Reward hacking — a query that retrieves everything | The budget constraint makes this lose by construction |
| LoCoMo too small to train on | Label-free rewards need no annotations, so training moves to any conversation corpus and LoCoMo stays held out |
| R1 too slow (long-context generation per candidate) | Cache aggressively; reduce *k*; R2 is cheap and can carry the project alone |
| 8GB VRAM | 3B base model with LoRA and 4-bit quantization; larger models inference-only |
| Someone publishes the same intersection mid-semester | The measurement and the harness stand regardless; positioning is one paragraph to rewrite |

---

## 12. Deadlines

| Date | Deliverable | Course |
|---|---|---|
| Mon Aug 24 | Declare project | CSCI 6970 — passed |
| **Mon Aug 31, 11:59pm MT** | **Proposal** | CSCI 6970 |
| Fri Sep 25 | Proposal | CSCI 5230 |
| **Mon Nov 30** | Final report | CSCI 6970 |
| Fri Dec 4 | Final report + presentation | CSCI 5230 |

Hard deadlines. No late work, no resubmission.

---

## 13. Open action items

1. **Email Banaei-Kashani about the topic change.** The Aug 24 declaration named the summarizer project. The domain is the same — long-term conversational memory — but the intervention moved from the write path to the read path. One paragraph before the proposal lands.
2. **Written authorization for dual submission.** Still outstanding. The CSCI 5230 syllabus treats unauthorized multiple submission as an honor code violation.
3. **Pull `MS-Course-Project-template.docx`** from Canvas and draft into it. The evaluation form is already in `0_Info/MS_Course_Project/`.
4. **Confirm LoCoMo's size.** The original paper describes 50 conversations; PPRO reports using 10 conversations and 1,540 QA pairs. Resolve which before writing numbers into the proposal.
5. **Office hours** — front desk 303-315-1408, Mondays 5:00–8:30pm, Thursdays 6:00–7:30pm, by appointment.

---

## 14. Sources

**Nearest prior work**
- [Learning User-Aware Recall: Personalized Retrieval in Long-Term Conversational Memory (PPRO)](https://arxiv.org/abs/2607.00017) — trained rewriter for memory, GRPO, supervised by gold evidence; names the unsupervised case as open
- [ConvSearch-R1: Enhancing Query Reformulation for Conversational Search with Reasoning via RL](https://arxiv.org/abs/2505.15776) — removes rewrite supervision, corpus search
- [Annotation-Free Reinforcement Learning Query Rewriting via Verifiable Search Reward (RL-QR)](https://arxiv.org/abs/2507.23242) — synthetic index-aligned queries as reward
- [Adaptive Query Rewriting: Aligning Rewriters through Marginal Probability of Conversational Answers (AdaQR)](https://arxiv.org/html/2406.10991) — reward from conversation turns, no passage labels
- [From Passive Retrieval to Active Memory Navigation](https://arxiv.org/pdf/2607.05794) — trained decomposition over memory, uses gold evidence
- [MaFeRw: Query Rewriting with Multi-Aspect Feedbacks](https://arxiv.org/pdf/2408.17072) — multiple reward signals combined

**Foundational**
- [Query Rewriting for Retrieval-Augmented Large Language Models (RRR)](https://arxiv.org/abs/2305.14283)
- [CONQRR: Conversational Query Rewriting for Retrieval with Reinforcement Learning](https://aclanthology.org/2022.emnlp-main.679.pdf)
- [Learning to summarize from human feedback](https://arxiv.org/abs/2009.01325) — Wk 13; the training method

**Benchmarks and memory systems**
- [Evaluating Very Long-Term Conversational Memory of LLM Agents (LoCoMo)](https://arxiv.org/abs/2402.17753)
- [LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory](https://arxiv.org/abs/2410.10813)
- [In Prospect and Retrospect: Reflective Memory Management (RMM)](https://arxiv.org/abs/2503.08026)
- [RAPTOR: Recursive Abstractive Processing for Tree-Organized Retrieval](https://arxiv.org/html/2401.18059v1)
- [Revisiting Zep's 84% LoCoMo Claim](https://github.com/getzep/zep-papers/issues/5) — why per-category reporting matters

**Course readings load-bearing in the design**
- [The Curious Case of Neural Text Degeneration](https://arxiv.org/abs/1904.09751) — Wk 16; candidate sampling
- [How NOT To Evaluate Your Dialogue System](https://arxiv.org/abs/1603.08023) — Wk 16; extrinsic evaluation
- [BLEU](https://aclanthology.org/P02-1040.pdf) — Wk 8; the metric argued against
- [Evaluation methods for unsupervised word embeddings](https://aclanthology.org/D15-1036/) — Wk 3
- [Finetuned Language Models Are Zero-Shot Learners](https://arxiv.org/abs/2109.01652) — Wk 13
