from collections import Counter, defaultdict
from collections.abc import Iterable
from statistics import mean, stdev

from .evaluate_rewriters import DIAGNOSTIC


LABEL_FREE = ("r1", "r2", "r3")


def summarize(rows: Iterable[dict], excluded: dict, *, headroom_only: bool = False) -> dict:
    groups = defaultdict(list)
    comparisons = defaultdict(dict)
    queries = defaultdict(dict)
    for row in rows:
        variant, seed, category, budget = (row[key] for key in ("variant", "seed", "category", "budget"))
        for category_key in ("all", category):
            groups[variant, seed, category_key, budget].append(row)
        if variant in LABEL_FREE:
            key = seed, row["question_id"], category
            comparisons[key + (budget,)][variant] = row
            queries[key][variant] = row["query"]

    failures = defaultdict(Counter)
    for (seed, _, category, budget), entries in comparisons.items():
        if entries.keys() != set(LABEL_FREE):
            raise ValueError("Label-free observations are incomplete.")
        best = max(entries.values(), key=lambda row: row["recall"])
        miss = "+".join(reward for reward in LABEL_FREE if entries[reward]["recall"] == 0) or "none"
        for category_key in ("all", category):
            groups["best_of_three", seed, category_key, budget].append(best)
            failures[seed, category_key, budget][miss] += 1

    per_seed = []
    for (variant, seed, category, budget), entries in sorted(groups.items()):
        ranks = [row["first_hit_rank"] for row in entries if row["first_hit_rank"] is not None]
        per_seed.append({
            "variant": variant, "seed": seed, "category": category, "budget": budget,
            "questions": len(entries), "mean_recall": mean(row["recall"] for row in entries),
            "mean_tokens_used": mean(row["tokens_used"] for row in entries),
            "mean_first_hit_rank": mean(ranks) if ranks else None,
            "miss_rate": 1 - len(ranks) / len(entries),
            "blank_rewrites": sum(row["blank_rewrite"] for row in entries),
        })

    paired = defaultdict(dict)
    for row in per_seed:
        paired[row["category"], row["budget"], row["seed"]][row["variant"]] = row
    expected = {"raw", "prompted", DIAGNOSTIC}
    if not headroom_only:
        expected.update(("r0", "best_of_three", *LABEL_FREE))
    for variants in paired.values():
        if variants.keys() != expected:
            raise ValueError("The evaluation observations are incomplete.")
        raw = variants["raw"]["mean_recall"]
        prompted = variants["prompted"]["mean_recall"]
        for variant, row in variants.items():
            recall = row["mean_recall"]
            row["delta_vs_raw"] = recall - raw
            row["delta_vs_prompted"] = recall - prompted
            if variant in LABEL_FREE:
                r0 = variants["r0"]["mean_recall"]
                row["recall_vs_r0"] = recall / r0 if r0 else None
                row["r0_gain_recovered"] = (recall - prompted) / (r0 - prompted) if r0 > prompted else None

    by_curve = defaultdict(list)
    for row in per_seed:
        by_curve[row["variant"], row["category"], row["budget"]].append(row)
    curves = []
    metric_keys = (
        "mean_recall", "mean_tokens_used", "mean_first_hit_rank", "miss_rate", "blank_rewrites",
        "delta_vs_raw", "delta_vs_prompted", "recall_vs_r0", "r0_gain_recovered",
    )
    for (variant, category, budget), entries in sorted(by_curve.items()):
        aggregate = {"variant": variant, "category": category, "budget": budget,
                     "questions_per_seed": entries[0]["questions"], "seeds": len(entries)}
        for key in metric_keys:
            values = [row[key] for row in entries if row.get(key) is not None]
            if values or any(key in row for row in entries):
                aggregate[key] = mean(values) if values else None
                aggregate[f"{key}_seed_std"] = stdev(values) if len(values) > 1 else None
                aggregate[f"{key}_seed_count"] = len(values)
        curves.append(aggregate)

    lexical = defaultdict(list)
    for (seed, _, category), variants in queries.items():
        for index, left in enumerate(LABEL_FREE):
            for right in LABEL_FREE[index + 1:]:
                a = variants[left].casefold().split()
                b = variants[right].casefold().split()
                union = set(a) | set(b)
                for cat in ("all", category):
                    lexical[seed, cat, left, right].append((a == b, len(set(a) & set(b)) / len(union)))

    return {
        "excluded_questions": excluded, "per_seed": per_seed, "curves": curves,
        "failure_overlap": [
            {"seed": seed, "category": category, "budget": budget, "zero_recall": dict(counts)}
            for (seed, category, budget), counts in sorted(failures.items())
        ],
        "rewrite_similarity": [
            {"seed": seed, "category": category, "variants": [left, right], "questions": len(values),
             "exact_match_rate": mean(a for a, _ in values), "mean_token_jaccard": mean(b for _, b in values)}
            for (seed, category, left, right), values in sorted(lexical.items())
        ],
    }
