
# Project Statement — Training Consumer-Scale Summarizers for Hierarchical Conversational Memory

CSCI 6970 MS Course Project / CSCI 5230 NLP & GenAI Term Project · Ronald Yu · Fall 2026
Settled framing as of 2026-08-20. Supersedes review v1 and v2.

---

## Short statement (declaration-length, ~130 words)

> Long-term conversational agents cannot retain full interaction histories in context, so memory systems compress prior dialogue into a retrievable store. The strongest current designs are hierarchical: model-generated summaries act as coarse retrieval units that route a query to the raw turns beneath them, which makes summary quality load-bearing — a summary that omits a detail renders the underlying turns unreachable. Yet in every such system the summarizer is a prompted, frozen, general-purpose model, usually frontier-scale, and is never trained for the task it performs. This project builds a fine-tuning pipeline that manufactures its own supervision from downstream retrieval outcomes, requiring no reference summaries, and applies it to consumer-scale open-weight models. It then measures, on the LoCoMo long-term conversation benchmark, whether a fine-tuned 3–4B summarizer closes the gap to a prompted 7–8B one, and which measurable properties of a summary actually predict memory system performance.

---

## Full problem statement

Conversational agents that persist across weeks or months cannot hold their entire interaction history in context. Memory systems address this by compressing prior conversation into a retrievable store, and the strongest current designs are hierarchical: systems such as RAPTOR and HiGMem build multi-level structures in which model-generated summaries serve as coarse retrieval units that route a query toward the raw dialogue turns beneath them. The quality of those summaries is therefore load-bearing. A summary that omits or distorts a detail can make the turns underneath it unreachable, and a retrieval miss at the summary level cannot be recovered at any level below it.

Yet in every such system the summarizer is a prompted, frozen, general-purpose model, and typically a frontier-scale one. It is never trained for the task it performs. That is defensible when the summarizer is GPT-3.5-turbo or larger — RAPTOR's authors observed that even hallucinated summaries had no discernible effect on downstream question answering — but it is an untested assumption at the model scales that fit consumer hardware, where a locally run 1–4B model must produce those same summaries. The published evidence is also contradictory: SeCom reports that summary-based memory *underperforms* raw segment retrieval on LoCoMo because of information loss, while hierarchical systems continue to depend on summaries and report gains over flat retrieval. Whether summarization helps or harms conversational memory, and whether summarizer capacity is what decides it, is genuinely open.

The obstacle to settling this by training is that no supervised dataset of conversation-to-memory summaries exists, and there is no reference summary against which to compute a loss. This project's central move is to manufacture supervision from the memory system itself: for each conversation segment, sample candidate summaries from a base model, score each candidate by whether the benchmark's gold evidence turns are retrieved when that summary indexes them, and fine-tune on the outcomes. The training signal is the downstream retrieval result. It requires no human references and no LLM judge, and it is computable entirely offline on a single consumer GPU.

The project delivers two things. The first is that fine-tuning pipeline, built to be base-model-agnostic and demonstrated across multiple small open-weight families. The second is an empirical characterization, obtained by running the pipeline inside a deterministic hierarchical memory system evaluated on LoCoMo: whether a fine-tuned consumer-scale summarizer closes the gap to a prompted 7–8B model, which question categories any gains concentrate in, and — the analysis question that motivates the entire design — which measurable properties of a summary (entity retention, compression ratio, factual consistency, lexical overlap) actually predict memory system performance, as distinct from those that merely score well on conventional summarization metrics.

**Stakeholders.** Anyone who cannot send conversation history to a hosted API: privacy-constrained deployments in healthcare, legal, and counseling contexts; on-device assistant vendors operating under fixed VRAM budgets; and individual users of local assistants. Hierarchical memory currently assumes a frontier-scale summarizer, which is precisely the component these deployments cannot have.

---

## Grounding in CSCI 5230 course content

| Course unit                                                                           | Use in this project                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Word Vectors; Evaluation Methods for Unsupervised Word Embeddings** (Wk 2–3) | Dense embedding retrieval over summary and turn vectors is the entire level-1 routing mechanism. Encoder choice and its intrinsic-vs-extrinsic evaluation are direct experimental variables.                                                                                                                                                                                                                                      |
| **Seq2Seq Models and Attention; BLEU** (Wk 7–8)                                | Summarization is the canonical conditional generation task; the BLEU reading grounds the intrinsic-metric critique that motivates extrinsic evaluation here.                                                                                                                                                                                                                                                                      |
| **Self-Attention and Transformers** (Wk 9–10)                                  | All base models are decoder-only transformers. Quadratic attention cost and bounded context are the reason conversational memory compression is necessary at all — the project's premise is a direct consequence of this lecture.                                                                                                                                                                                                |
| **Pretraining and Transfer Learning** (Wk 11–12)                               | The core method is parameter-efficient transfer of a pretrained base model to a specialized downstream task via LoRA.                                                                                                                                                                                                                                                                                                             |
| **Prompting and RLHF** (Wk 13)                                                  | Prompted summarizers are the baseline; the trained model is the contribution. Rejection-sampling SFT — and optional preference optimization over (winner, loser) summary pairs — is the method of*Learning to Summarize from Human Feedback* with an automated retrieval-derived preference signal substituted for human annotation. *Finetuned Language Models Are Zero-Shot Learners* motivates task-specific adaptation. |
| **Natural Language Generation** (Wk 16)                                         | *Get To The Point* situates the summarization lineage; *The Curious Case of Neural Text Degeneration* governs the decoding strategy used to sample diverse summary candidates for rejection sampling; *How NOT To Evaluate Your Dialogue System* is the direct justification for evaluating summaries extrinsically through the memory system rather than by ROUGE against references.                                      |

Nearly every unit of the course is load-bearing rather than decorative. State this explicitly in the proposal — it is what distinguishes a term project from an applied engineering exercise.

## Grounding in the project guidelines

| Requirement                                                                   | Satisfied by                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Individual semester project (CSCI 6970)                                       | Solo throughout. No team, per MS Course Project rules.                                                                                                                                                        |
| Data accessible in needed quantity and quality (kick-off checklist)           | LoCoMo is public (50 conversations, ~300 turns / ~9K tokens each, with gold evidence-turn annotations); synthetic generation via the LoCoMo persona/event-graph pipeline extends training data without bound. |
| Enabled by NLP technologies studied in the course                             | See mapping above.                                                                                                                                                                                            |
| Interesting questions with outside stakeholders                               | Local/private deployment under fixed VRAM; see Stakeholders above.                                                                                                                                            |
| Non-obvious research questions                                                | Does summarizer capacity determine whether summarization helps or hurts memory? Do intrinsic summary metrics predict memory utility? Do gains concentrate in multi-hop and temporal questions?                |
| Significant research and implementation (CSCI 6970)                           | Adapting document-oriented hierarchical retrieval to conversation sessions; building the candidate-sampling and retrieval-scoring training loop; multi-model fine-tuning and evaluation harness.              |
| Proof-of-concept prototype (CSCI 5230)                                        | A fully local hierarchical conversational memory system running under an 8 GB VRAM budget.                                                                                                                    |
| Written report with research, implementation, results, analysis, bibliography | Structure follows the contribution split: pipeline (implementation) + benchmark characterization (results and analysis).                                                                                      |

---

## Settled design decisions

- **Instrument: RAPTOR**, adapted from documents to conversation sessions. Retrieval is pure cosine similarity over precomputed SBERT embeddings with no LLM at query time; the LLM is used *exclusively* at build time for summarization — which is precisely and only the intervention point. Every downstream change is attributable to summary quality by construction. Use the collapsed-tree variant (the authors' best configuration, 2000-token budget) so summaries and raw leaves compete in one index, enabling analysis of which tree level is retrieved per question category.
- **Secondary instrument: HiGMem** with Phases 2–3 (LLM turn filtering) ablated, to confirm gains survive in a second architecture. Report the full-LLM-filter version separately; a strong filter can mask a weak summarizer.
- **Retrieval hit definition: subtree containment** — a hit means retrieving a node whose descendants include the gold evidence turn. Deterministic and free. Fact-level containment is a secondary diagnostic only. State this choice explicitly; reviewers will ask.
- **Model pairs from the same family** so comparisons isolate scale, not training data: Qwen3-4B vs 8B, or Llama-3.2-3B vs Llama-3.1-8B. Pipeline must run on ≥2 families to earn the word "pipeline."
- **Frozen throughout**: encoder, retriever, *k*, reader model, chunking. Report compression ratio and token budget on every row; plot accuracy against token budget as curves, not points.
- **Per-category LoCoMo results**, never a single average. Treat sub-2-point F1 deltas as noise — see the Zep/Mem0 dispute in which an 84% LoCoMo claim was recomputed at 58.44%.
- **Locomo-Plus is secondary and eval-only.** Its authors state it is unsuitable for training or fine-tuning, and all systems score 14–26%. Use it to test one specific hypothesis: that summarization degrades implicit-constraint (cognitive) questions asymmetrically relative to factual ones.

### Week-1 go/no-go checks

1. **Measure the prompted-3B vs prompted-7B gap first.** If it is under ~2 points, there is no gap to close and the headline claim must pivot to efficiency. Find this out in week 1, not week 10.
2. **Measure level-1 recall@k for prompted baselines.** If it already exceeds ~0.95 within a single conversation, the routing problem is too easy — pool sessions across all 10 LoCoMo conversations into one index (~350–500 candidates) and make that the primary setting. This is harder, more realistic, and a condition the cited papers do not run.
3. **Verify nobody has published RAPTOR-on-LoCoMo.** Search did not surface one, but confirm before committing.

### Baseline ladder (retriever, reader, and *k* held fixed)

0. Flat top-*k* chunk retrieval, no hierarchy — the Nano-Memory threat
1. Mean-pooled chunk embeddings of the raw session
2. Max-pool over chunk embeddings
3. Lead-N / TextRank extractive
4. Entity + keyword list (is prose the wrong format for an index?)
5. Prompted small LLM summary — the untrained status quo
6. Prompted 7–8B summary — the target to close the gap to
7. **Fine-tuned consumer-scale summarizer** — the contribution

If row 7 does not clear rows 5 and 6 by more than noise, rows 0–4 explain why and the analysis half of the project still stands. Pre-register in the proposal which analyses will be reported regardless of outcome.

---

## Deadlines

| Date                             | Deliverable                 | Course    |
| -------------------------------- | --------------------------- | --------- |
| **Mon Aug 24, 11:59pm MT** | **Declare project**   | CSCI 6970 |
| **Mon Aug 31, 11:59pm MT** | Proposal                    | CSCI 6970 |
| Fri Sep 25                       | Proposal                    | CSCI 5230 |
| **Mon Nov 30**             | Final report                | CSCI 6970 |
| Fri Dec 4                        | Final report + presentation | CSCI 5230 |

Hard deadlines. No late work, no resubmission, no exceptions.

**Open action items:** get written authorization from Banaei-Kashani to submit one project for both courses (the CSCI 5230 syllabus lists unauthorized "multiple submissions" as an honor code violation); pull `MS-Course-Project-Report-Evaluation-Form.docx` and `MS-Course-Project-template.docx` from Canvas and write against the actual rubric; take the pre-proposal office-hours meeting (front desk 303-315-1408).

---

## Sources

- [RAPTOR: Recursive Abstractive Processing for Tree-Organized Retrieval](https://arxiv.org/html/2401.18059v1) (ICLR 2024)
- [HiGMem: A Hierarchical and LLM-Guided Memory System for Long-Term Conversational Agents](https://arxiv.org/html/2604.18349)
- [On Memory Construction and Retrieval for Personalized Conversational Agents (SeCom)](https://arxiv.org/html/2502.05589v3)
- [Back to Basics: Let Conversational Agents Remember with Just Retrieval and Generation (Nano-Memory)](https://arxiv.org/html/2604.11628v1)
- [LightMem: Lightweight LLM Agent Memory with Small Language Models](https://arxiv.org/html/2604.07798v1)
- [Evaluating Very Long-Term Conversational Memory of LLM Agents (LoCoMo)](https://arxiv.org/pdf/2402.17753)
- [Locomo-Plus: Beyond-Factual Cognitive Memory Evaluation Framework for LLM Agents](https://arxiv.org/html/2602.10715v1)
- [Recursively Summarizing Enables Long-Term Dialogue Memory in Large Language Models](https://arxiv.org/html/2308.15022v4)
- [Revisiting Zep&#39;s 84% LoCoMo Claim](https://github.com/getzep/zep-papers/issues/5)
