# Training Memory Query Rewriters Without Evidence Labels

Ronald Yu
CSCI 6970 MS Course Project
Fall 2026

## Introduction

Assistants with long-term memory search a store built from past conversations, so they can answer questions about things said weeks or months ago. However, nearly all of them search using the user's current message, embedded as-is, which is often a bad search key.

For example, imagine asking an assistant "should I bring a jacket to dinner tomorrow?" And the memories that answer it are "I get cold easily," from three months ago, and "dinner's on the rooftop patio," from yesterday. Neither is close to "jacket" in embedding space. And tuning the retriever does not fix that, so the query has to change.

PPRO (2026) does exactly this [1]. It trains a small model to rewrite the message before searching, and freezes the memory store, the encoder, and the answer model so the query is the only thing that moves; reporting gains on LoCoMo [2] and LongMemEval-S [3]. The problem is how it trains. PPRO scores a rewrite by overlap with annotated evidence turns, plus similarity to a reference answer. Both are human annotations, while a deployed assistant has the user's history and nothing else. Thus, the method cannot be trained on the data it is meant to serve, and the authors name this as an open limitation.

This project trains a memory query rewriter with no evidence labels. The training reward is built from the conversation itself. Three ways of building it are implemented and compared, and all three are evaluated on LoCoMo's held-out test split against annotations no label-free training run ever reads. The result is a measurement: how much of a supervised rewriter's gain survives once the labels are gone.

## The Gap

Trained query rewriting is established outside of memory: RRR [4] and CONQRR [5] did it for open-domain and conversational search years ago. Applying it to long-term memory is recent, and PPRO is the strongest version, but it is supervised [1]. Label-free rewriter training also exists. ConvSearch-R1 [6] and RL-QR [7] drop rewrite supervision, and AdaQR [8] builds a reward from conversation turns alone. All three search an external corpus.

Personal memory is not a corpus. It is small enough to fit in a context window, it has no canonical documents, and the person asking the question wrote the content. The first property is the one this project uses. A user's history can be read in full offline during training, even though cost and latency force retrieval at serving time. That gap between training and serving is where a teacher signal can come from.

The missing intersection is narrow: a memory query rewriter trained with no evidence labels, plus a comparison of the label-free signals that make it possible. This combines two existing lines of work rather than inventing one; aiming to measure the delta precisely.

Research questions, ordered so the later ones survive if the first comes out flat:

1. A rewriter trained on human-annotated evidence sets the bar. How much of that gain can a rewriter reach when its training signal comes from the conversation alone?
2. Do the different training signals produce different queries, and do they fail on different questions? If the best of them could be picked per question, how much better would that be?
3. Does the answer change with the kind of question being asked, such as one whose answer sits in a single message versus one that needs two separate facts combined?
4. This project differs from PPRO in two ways at once: no labels, and a simpler training method. How much of the difference in results comes from each?

## Contribution and Stakeholders

The project contributes three things. First, a way to train a memory query rewriter with no annotated evidence, where the training signal is manufactured from the conversation itself. Second, a head-to-head measurement of three such signals against a rewriter trained on human annotations, broken out by question type, so the cost of dropping labels is a number instead of a guess. Third, a harness in which memory construction, the embedding model, the answer model, and the context budget are all held fixed, so a new training signal can be swapped in and compared on equal terms.

Those map onto three groups. Teams deploying memory systems on real user data have conversation logs and no annotations, and cannot produce them at scale; the first contribution is a recipe that runs on what they actually have, and the second tells them what it costs against the annotated ideal. Anyone running memory retrieval on-device or under a cost limit needs the rewriter to be a small local model rather than a frontier API call, and every configuration compared here is small enough to run locally, with one baseline included specifically to price what an API call would have bought. Researchers working on memory retrieval get the frozen harness and a set of baselines measured under identical conditions, which is what makes a later result comparable to this one.

## Approach

Two rules control the project:

- Gold evidence annotations never enter a label-free training loop. Only the supervised ceiling reads them, and only so that it can serve as the ceiling; every other trained result is produced without them, and all of them are scored against them at evaluation.
- Everything except the rewriter is frozen: memory construction, encoder, answer model, retrieval depth, context budget, and the training corpus. Every measured difference comes from the query.

The teacher signal is the training reward, and it replaces the annotation-based score PPRO uses. The training loop around it is deliberately simple: generate several different rewrites of the same question, score each one with the chosen reward, keep the best ones, and fine-tune the model on those. This is rejection sampling followed by supervised fine-tuning, the method used in Learning to Summarize from Human Feedback [9] with a manufactured score standing in for human preference. Fine-tuning uses LoRA, which trains a small set of added weights instead of the whole model and therefore fits on modest hardware [10]. Generating the candidates uses randomized decoding so they are not all identical, since a set of near-identical candidates gives the reward nothing to choose between [11]. Scoring happens offline, where reading the full conversation is affordable. The trained rewriter never sees the full conversation at serving time; it sees only the user's message.

Four components, each testable alone:

- Memory pipeline. Splits a conversation into memories, embeds them with a frozen encoder, and stores them. Follows a published configuration rather than an invented one, so the baseline is recognizable.
- Retrieval and budget harness. Runs a query, returns memories up to a fixed token budget, and scores the result.
- Reward bank. Three label-free scorers behind one interface, so swapping the training signal is a config change. This is the core of the project.
- Candidate factory and training loop. Generates the candidate rewrites, scores them, assembles the winners into a fine-tuning set, and runs the fine-tune.

The three label-free rewards, plus the ceiling they are measured against:

- R1, full-context teacher. A LoCoMo conversation fits in a modern context window. Answer the question twice: once from what the candidate query retrieved, once from the whole conversation. The reward is agreement between the two. The full conversation is a free teacher, available only because personal history is small. Closest prior work is AdaQR [8], which uses answer probability in corpus search; the difference is that this teacher sees the entire store.
- R2, masked-turn prediction. Hide a message from the conversation. Build a query from the messages before it. The reward is how much the retrieved memories improve the model's ability to predict the hidden message. No question, no answer, no labels. The conversation supervises itself, and this is the cheapest of the three.
- R3, synthetic evidence. Pick a message, generate a question it answers, keep the pair. That manufactures question-and-evidence pairs for free. Closest prior work is RL-QR's synthetic queries [7]. Its known weakness is the reason to include it: a question generated from a message tends to reuse that message's wording, which is the easy case a rewriter is least needed for.
- R0, supervised ceiling. PPRO's retrieval reward, measured as overlap with the annotated evidence, trained with the same procedure, budget, and base model. Not a competitor. Every label-free result is reported as a fraction of it. PPRO's published reward is actually a weighted sum of that overlap and a BLEU score against a reference answer [1]; the BLEU term is dropped here for the reason given under Evaluation, so R0 is the retrieval half alone. This is also why the ceiling is retrained rather than cited: the published number scores a different reward, on a different memory pipeline, trained with a different optimizer, and comparing a label-free result against it would move four variables at once.

All four rewards train on the same corpus, so the reward is the only thing that differs between them. What each one draws from that corpus differs, though. R2 and R3 need the conversations and nothing else: R2 hides a message that is already there, and R3 writes its own questions from messages that are already there. R1 additionally needs questions asked over those conversations, since it scores a candidate by how well the memories it retrieved support the answer, and something has to do the asking; the answers themselves are not needed, because the full-conversation teacher supplies them. R0 additionally needs the evidence annotations. The training corpus therefore has to be an annotated one even though three of the four rewards ignore its annotations, and only R0 ever reads them. That is what keeps rule one intact while still holding the data constant: the label-free training loops never see a label, and the comparison against the ceiling changes one variable rather than two.

The corpus is LoCoMo itself, using the split PPRO trained on: 152 question-answer pairs from one conversation for training, 81 from a second for validation, and 1,307 across the remaining eight conversations held out for testing, or 1,540 pairs over ten conversations in total [1]. Two consequences follow. The claim this project can make is that the test split is never trained on, not that LoCoMo is untouched, which is the same claim PPRO makes. And reusing the published split means results land on the same questions as the published ones, so the external comparison in research question 4 is a much closer match than a reimplementation on a different subset would be. The original LoCoMo release describes fifty conversations [2]; the ten-conversation version is what PPRO uses and what makes the comparison line up.

A training set of 152 questions is small, and it binds the four rewards unevenly. R0 cannot exceed it, because that is how many annotated pairs exist, and R1 cannot exceed it either, because that is how many questions exist. R2 and R3 are not bound by it at all: every message in the training conversation is a candidate masked turn or a source for a generated question, so both can manufacture far more examples than 152 from exactly the same text. Holding the corpus fixed therefore does not hold the number of training examples fixed. The comparison is run both ways. Capping every reward at the same number of examples answers research question 1 with one variable moving, and letting R2 and R3 use everything they can generate measures what the label-free framing actually buys, which is the ability to keep going after the annotations run out.

What this project does not do, stated so the boundary is visible:

- Memory construction. How memories are extracted, summarized, and indexed is frozen. Only the query changes.
- Reranking. Excluded so the path from query to retrieved set stays unbroken.
- Retriever training. The encoder is frozen. The intervention is the query, never the index.
- Reinforcement learning. PPRO trains with reinforcement learning. This project uses the simpler generate-score-keep-fine-tune loop, which fits the available hardware and is easier to debug. The difference is reported as a finding, not hidden, and is research question 4.
- Breaking one question into several queries. Interesting, but it is a second contribution and this project has one. Named in future work.

## Evaluation

The primary metric is recall of the annotated evidence under a fixed token budget: of the memories the benchmark marks as needed to answer a question, how many did this query actually retrieve, when the retrieved set is capped at a set number of tokens. It is the primary metric because it measures the one thing the query controls, and because it bounds everything downstream. If the needed memories never come back, no answer model can recover them. The cap is what keeps the measurement honest, since without it a query that drags back the entire conversation would score perfectly while being useless in practice. Results are reported as a curve across several budget sizes rather than a single number, because a method that wins only when the budget is generous is a different result from one that wins everywhere, and real deployments differ in how much context they can afford.

Three secondary metrics, each answering something recall cannot:

- Answer quality from a frozen answer model. Recall says the needed memories came back; this says they were enough to actually produce a correct answer, which is what a user would feel. It stays secondary because it mixes retrieval quality with the answer model's own ability.
- Rank of the first needed memory. Two queries can retrieve the same memories while one puts the needed one first and the other buries it near the bottom. That difference matters whenever the list gets truncated, and answer models tend to use early context more reliably than late context.
- How much of the token budget actually gets used. A query that reaches the same recall on half the budget is cheaper to serve and leaves room for the rest of the prompt. It also acts as a tripwire: a query drifting toward retrieving everything shows up here first.

Every number is reported per question category rather than as one average. LoCoMo labels each question by the kind of reasoning it needs: single-hop, where the answer sits in one message; multi-hop, which requires combining two or more messages; temporal, about when something happened or in what order; and open-domain, which needs outside knowledge on top of the conversation. These are not equally hard, and query rewriting should not help them equally. Single-hop questions often work with the raw message already, while multi-hop and temporal questions are where a rewrite has the most to add. A single average can therefore hide a large multi-hop gain behind a saturated single-hop score, or let a method that only helps the easy category look like a general improvement. Published headline LoCoMo numbers have been disputed on roughly these grounds [14], so this project reports each category separately, repeats runs with different random seeds, and treats differences under about two points as noise rather than results.

This follows the broader argument in the evaluation literature that generated text should be judged by what it accomplishes rather than by its resemblance to a reference [12], which is also why the project does not score a rewrite by its similarity to a reference answer the way overlap metrics such as BLEU would [13]. A rewrite is judged by what it retrieves, never by how it reads.

Comparison runs along a ladder of nine configurations, all evaluated on the held-out test split, with memory construction, encoder, answer model, retrieval depth, and budget frozen at every step:

0. Raw user message, embedded as-is. The status quo in nearly every memory system.
1. BM25 keyword search on the raw message. A non-neural floor.
2. Prompted rewrite, small model. Rewriting with no training.
3. Prompted rewrite, larger model. What an API call buys.
4. Trained on R1. Contribution.
5. Trained on R2. Contribution.
6. Trained on R3. Contribution.
7. Trained on R0, gold labels. Supervised ceiling.
8. Oracle query built directly from the annotated evidence. No real system could produce this query; it exists to bound what any query could achieve here.

Beyond the split, none of the three label-free rewards needs an annotation and R2 needs no questions either, so nothing stops them from training on an unlabeled multi-session conversation corpus that R0 could not use at all. The controlled comparison holds the corpus fixed so the reward is the only variable, and the uncapped run described above already tests part of this within LoCoMo. Extending the label-free rewards to a separate unlabeled corpus is the full version of that argument, and is the natural follow-on experiment if the schedule allows.

## Schedule

The proposal is due August 31, 2026 and the final report is due November 30, 2026. Work is planned in phases rather than by week, since the granularity of a week-by-week plan is not knowable this early.

- Phase 0, feasibility (early September). The go/no-go checks listed under Risks and Concerns. No training code gets written until these pass.
- Phase 1, baselines (September). Memory pipeline, retrieval and budget harness, and ladder steps 0 through 3 measured and frozen.
- Phase 2, rewards and first training runs (October). All three rewards implemented behind one interface, candidate generation and scoring working at scale, and the first trained rewriters.
- Phase 3, full comparison (early November). Remaining trained steps, the supervised ceiling, repeat runs with different seeds, and the per-category breakdown.
- Phase 4, analysis and writing (mid to late November). Research questions 2 through 4, then the report, with the remaining slack held here.

If the schedule slips, the first things cut are the second base model and the optional LongMemEval-S benchmark.

## Risks and Concerns

Feasibility, all resolved in Phase 0 before training code exists:

- No headroom over the raw message. If the raw message already retrieves the needed memories most of the time, there is nothing for a rewriter to fix. Measured first; if retrieval is near-saturated, the project narrows to multi-hop and temporal and says so.
- The ceiling is too low. Ladder step 8, the oracle query, gets built first. If a query built directly from the answer's own evidence cannot clearly beat the raw message, then no query can help in this setup, and that needs to be known immediately rather than after months of training runs.
- A reward that cannot tell good queries from bad. Each reward gets tested on a small sample: does it score the oracle query above the raw message? A reward that cannot separate those two will not train anything. This is the check that decides the project.
- The gap closes. Confirm that no published work trains a memory query rewriter without evidence labels; the nearest work as of August 30, 2026 is [1], [6], [7], and [8]. If someone publishes the same intersection mid-semester, the measurement and the harness still stand, and the positioning is one paragraph to rewrite.

Engineering:

- Candidate scoring is the throughput bottleneck. Every candidate rewrite has to be retrieved for and scored, which decides how many candidates per question are affordable, which in turn decides how much better the winners are than average. One structural saving applies: in R1 the full-conversation answer depends only on the question, not on the candidate, so it is computed once per question and reused across all of that question's candidates.
- R1 may still be too slow, since it requires generating an answer over a long input. Cache aggressively and cut the candidate count. If it still does not fit, R2 is cheap enough to carry the project alone.
- Limited GPU memory, 8GB. Training uses a roughly 3B-parameter model with LoRA and reduced-precision weights, and larger models are used for inference only and never trained. This constraint happens to align with the comparison rather than fighting it, since one of PPRO's reported configurations uses a 3B model, so the external comparison can match on base model size and not just on the evaluation split.
- Reproducibility. The entire analysis compares runs that differ in exactly one variable, so a run that cannot be regenerated from a seed and a config file is worthless. Every reported result gets regenerated from its config before it goes into the report.

Data and evaluation:

- Reward hacking, meaning a query that retrieves everything. It loses by construction because of the token budget, and the budget-use metric is the tripwire if it starts happening.
- The training split is small: 152 questions drawn from a single conversation, which is thin on persona variety as well as on volume. The mitigating fact is that this is the same data the published supervised result was trained on, so the comparison is a fair one even if the absolute numbers stay modest. If it proves too thin to train anything at all, the label-free rewards can fall back to an unlabeled multi-session corpus, at the cost of no longer sharing a corpus with the ceiling; that comparison would then be reported with the corpus difference stated rather than glossed. The test split stays held out either way.
- LongMemEval-S may not fit. It is a secondary evaluation benchmark, never a training corpus, and is used zero-shot exactly as PPRO used it [1], [3]. It is the first thing cut.

## Deliverables

- A working memory query-rewriting harness, four components, reproducible from a config file and a seed.
- A reward bank with three label-free signals plus the supervised ceiling.
- A training pipeline covering candidate generation, scoring, training-set assembly, and fine-tuning.
- Budget curves for all nine ladder steps, reported per question category, with repeat runs.
- Analysis: comparison of the three rewards, which questions each one fails, the best-of-three ceiling, and how much the rewrites differ from one another.
- A written final report to the six rubric criteria.

## Breadth and Mastery

### NLP and GenAI

The project sits on the course sequence almost lecture by lecture.

- Word Vectors (Lectures 1 and 2). Retrieval over memories is nearest-neighbor search in an embedding space, so what embeddings do and do not capture is the mechanism the whole project builds on. It is also the source of the design's central commitment: a rewrite is judged by what it retrieves, not by how it reads.
- Language Models and Recurrent Neural Networks (Lectures 5 and 6). R2 scores a query by how much the retrieved memories improve prediction of a hidden message. That is a language modeling objective repurposed as a retrieval signal.
- Sequence-to-Sequence Models and Attention (Lecture 7). Rewriting a question into a search query is conditional generation, the same input-to-output framing as translation.
- Self-Attention and Transformers (Lecture 8). The rewriter is a decoder-only transformer, while the embedding model is bidirectional with a hard input length limit, which is part of why searching with the raw message fails.
- Pretraining (Lecture 9). Adapting a pretrained model to a narrow task with LoRA is the training method [10], and R2 is a pretraining-style self-supervised objective used as a reward.
- Prompting and RLHF (Lecture 10). Ladder steps 2 and 3 are prompted baselines, and the training loop is the method of Learning to Summarize from Human Feedback [9] with a manufactured score in place of human preference.
- Natural Language Generation (Lecture 11). Candidate generation depends on the decoding literature [11], since candidates that are all alike leave the reward nothing to select. Evaluation follows the same literature's argument for judging generated text by what it accomplishes [12], [13].

### Rest of MS Studies

- Machine learning. Reward design, holding an evaluation set completely out of training, single-variable ablations, and treating variance across random seeds as part of the result rather than a footnote.
- Deep learning. Fine-tuning a pretrained model under a hard memory ceiling: adapter-based training, reduced-precision weights, and the trade-off between candidate count and throughput.
- Information retrieval. Dense retrieval and BM25, recall and rank metrics, and evaluation under a fixed budget.
- Software engineering. A four-component harness driven by config files, reproducible from a seed, with caching where it decides feasibility.
- Data engineering. Building a training set that does not exist, from sampling through scoring through filtering.

## References

[1] Learning User-Aware Recall: Personalized Retrieval in Long-Term Conversational Memory (PPRO). arXiv:2607.00017, 2026. https://arxiv.org/abs/2607.00017

[2] Maharana, A., et al. Evaluating Very Long-Term Conversational Memory of LLM Agents (LoCoMo). arXiv:2402.17753, 2024. https://arxiv.org/abs/2402.17753

[3] Wu, D., et al. LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory. arXiv:2410.10813, 2024. https://arxiv.org/abs/2410.10813

[4] Ma, X., et al. Query Rewriting for Retrieval-Augmented Large Language Models (RRR). arXiv:2305.14283, 2023. https://arxiv.org/abs/2305.14283

[5] Wu, Z., et al. CONQRR: Conversational Query Rewriting for Retrieval with Reinforcement Learning. Proceedings of EMNLP 2022. https://aclanthology.org/2022.emnlp-main.679.pdf

[6] ConvSearch-R1: Enhancing Query Reformulation for Conversational Search with Reasoning via Reinforcement Learning. arXiv:2505.15776, 2025. https://arxiv.org/abs/2505.15776

[7] Annotation-Free Reinforcement Learning Query Rewriting via Verifiable Search Reward (RL-QR). arXiv:2507.23242, 2025. https://arxiv.org/abs/2507.23242

[8] Adaptive Query Rewriting: Aligning Rewriters through Marginal Probability of Conversational Answers (AdaQR). arXiv:2406.10991, 2024. https://arxiv.org/html/2406.10991

[9] Stiennon, N., et al. Learning to Summarize from Human Feedback. arXiv:2009.01325, 2020. https://arxiv.org/abs/2009.01325

[10] Hu, E., et al. LoRA: Low-Rank Adaptation of Large Language Models. arXiv:2106.09685, 2021. https://arxiv.org/abs/2106.09685

[11] Holtzman, A., et al. The Curious Case of Neural Text Degeneration. arXiv:1904.09751, 2019. https://arxiv.org/abs/1904.09751

[12] Liu, C.-W., et al. How NOT To Evaluate Your Dialogue System: An Empirical Study of Unsupervised Evaluation Metrics for Dialogue Response Generation. arXiv:1603.08023, 2016. https://arxiv.org/abs/1603.08023

[13] Papineni, K., et al. BLEU: A Method for Automatic Evaluation of Machine Translation. Proceedings of ACL 2002. https://aclanthology.org/P02-1040.pdf

[14] Revisiting Zep's 84 Percent LoCoMo Claim. getzep/zep-papers issue 5. https://github.com/getzep/zep-papers/issues/5
