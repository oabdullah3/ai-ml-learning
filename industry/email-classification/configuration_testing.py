#!/usr/bin/env python3
"""
Email Priority Classifier — Configuration Testing Script

Runs 16 experiment configurations (1 baseline + 15 variants) sequentially,
comparing H-F1 scores across OVERALL / SEEN / INSCOPE / OUTSCOPE segments.

Usage:
    python configuration_testing.py path/to/data.xlsx
    python configuration_testing.py                     # auto-detects in test_cases/

Results saved to: logs/config_testing_<timestamp>/
    summary.csv                  — one-row-per-experiment comparison
    experiment_definitions.json  — reproducible config for each run
    <experiment_name>/           — full evaluator logs per experiment
"""

import sys
import os
import time
import glob
import json
from copy import deepcopy
from datetime import datetime

import pandas as pd

from email_classifier import config
from email_classifier.core import EmailContext
from email_classifier.pipeline import Pipeline
from email_classifier.preprocessors.html_cleaner import HtmlCleaner
from email_classifier.preprocessors.trimmer import EmailTrimmer
from email_classifier.classifiers.embedding_knn import EmbeddingKNNClassifier
from email_classifier.classifiers.setfit_classifier import SetFitClassifier
from email_classifier.evaluator import Evaluator


# ═════════════════════════════════════════════════════════════════════════════
# EXPERIMENT DEFINITIONS
# ═════════════════════════════════════════════════════════════════════════════
# Each entry: (experiment_name, {config_key: override_value, ...})
# Keys must match attribute names in email_classifier/config.py.
# Only list values that differ from defaults — everything else stays default.

EXPERIMENTS = [
    # ── Baseline (current config.py defaults, for comparison) ─────────────
    # ("BASELINE", {}),

    # ── Group A: SetFit Optimization ──────────────────────────────────────
    # Test how contrastive training intensity affects SetFit's learned
    # boundaries. k-NN stays at defaults; only SetFit params change.

    # ("A1_setfit_heavy", {
    #     # Hypothesis: more training pairs + epochs = better H/L separation
    #     "SETFIT_NUM_EPOCHS": 3,
    #     "SETFIT_NUM_ITERATIONS": 20,
    #     "SETFIT_MAX_STEPS": 500,
    #     "SETFIT_FORCE_RETRAIN": True,
    # }),
    # ("A2_setfit_minimal", {
    #     # Hypothesis: minimal training — does SetFit still outperform random?
    #     "SETFIT_NUM_EPOCHS": 1,
    #     "SETFIT_NUM_ITERATIONS": 5,
    #     "SETFIT_MAX_STEPS": 50,
    #     "SETFIT_FORCE_RETRAIN": True,
    # }),
    # ("A3_setfit_large_batch", {
    #     # Hypothesis: larger batch size improves contrastive learning
    #     "SETFIT_BATCH_SIZE": 64,
    #     "SETFIT_NUM_EPOCHS": 2,
    #     "SETFIT_NUM_ITERATIONS": 15,
    #     "SETFIT_FORCE_RETRAIN": True,
    # }),
    ("A4_setfit_e5_model", {
        # Hypothesis: stronger base model (768-dim) → better fine-tuned embeddings
        # NOTE: First run downloads ~1.1 GB model
        "SETFIT_MODEL_NAME": "intfloat/multilingual-e5-base",
        "SETFIT_FORCE_RETRAIN": True,
    }),
    # ("A5_setfit_high_iters", {
    #     # Hypothesis: many iterations with no step cap maximizes pair diversity
    #     "SETFIT_NUM_ITERATIONS": 30,
    #     "SETFIT_MAX_STEPS": -1,
    #     "SETFIT_FORCE_RETRAIN": True,
    # }),

    # ── Group B: k-NN Optimization ────────────────────────────────────────
    # Adjust k and decision thresholds to shift precision/recall tradeoff.
    # SetFit stays at defaults; only k-NN params change.

    # ("B1_knn_aggressive_H", {
    #     # Hypothesis: lower thresholds → catch more H (higher recall, risk more FP)
    #     "KNN_H_RATIO_THRESHOLD": 0.45,
    #     "KNN_H_RATIO_STRICT": 0.55,
    #     "KNN_MIN_SIMILARITY": 0.25,
    # }),
    # ("B2_knn_k3", {
    #     # Hypothesis: fewer neighbors → more responsive, noisier
    #     "KNN_K": 3,
    # }),
    # ("B3_knn_e5_model", {
    #     # Hypothesis: stronger embedding model for k-NN similarity search
    #     # SetFit stays on MiniLM; only k-NN embedding changes
    #     "KNN_MODEL_NAME": "intfloat/multilingual-e5-base",
    # }),
    # ("B4_knn_k7_strict", {
    #     # Hypothesis: more neighbors + stricter thresholds → conservative, fewer FP
    #     "KNN_K": 7,
    #     "KNN_H_RATIO_THRESHOLD": 0.60,
    #     "KNN_H_RATIO_STRICT": 0.70,
    # }),

    # ── Group C: Preprocessing Impact ─────────────────────────────────────
    # Test whether trimming (extracting dept message only) helps or hurts.
    # Default has ENABLE_TRIMMING=False (classifiers see full clean_text).

    # ("C1_trimming_on", {
    #     # Hypothesis: trimming removes noisy template text → cleaner signal
    #     "ENABLE_TRIMMING": True,
    # }),
    # ("C2_trimming_on_setfit_only", {
    #     # Hypothesis: trimmed text + SetFit alone (no k-NN noise)
    #     "ENABLE_TRIMMING": True,
    #     "ADD_EMBEDDING_KNN": False,
    # }),

    # ── Group D: Ensemble Weighting ───────────────────────────────────────
    # Test whether one classifier should dominate, or if a different
    # aggregation mode works better.

    # ("D1_setfit_dominant", {
    #     # Hypothesis: SetFit is more accurate → give it 2× the vote
    #     "SETFIT_WEIGHT": 2.0,
    #     "KNN_WEIGHT": 1.0,
    # }),
    # ("D2_knn_dominant", {
    #     # Hypothesis: k-NN generalizes better → give it 2× the vote
    #     "KNN_WEIGHT": 2.0,
    #     "SETFIT_WEIGHT": 1.0,
    # }),
    # ("D3_first_confident", {
    #     # Hypothesis: first_confident avoids conflicting votes
    #     "PIPELINE_MODE": "first_confident",
    # }),

    # ── Group E: Combined Best ────────────────────────────────────────────
    # After reviewing A–D results, fill in the winning values below.

    # ("E1_combined_best", {
    #     # ┌─────────────────────────────────────────────────────────────┐
    #     # │ TODO: Replace with the best values found from Groups A–D.  │
    #     # │ Uncomment and adjust the lines below after reviewing       │
    #     # │ the comparison table from the first run.                   │
    #     # └─────────────────────────────────────────────────────────────┘
    #     # "SETFIT_NUM_EPOCHS": 3,
    #     # "SETFIT_NUM_ITERATIONS": 20,
    #     # "SETFIT_MAX_STEPS": 500,
    #     # "SETFIT_FORCE_RETRAIN": True,
    #     # "KNN_K": 3,
    #     # "SETFIT_WEIGHT": 2.0,
    # }),
]


# ═════════════════════════════════════════════════════════════════════════════
# CONFIG MANAGEMENT
# ═════════════════════════════════════════════════════════════════════════════

_CONFIG_KEYS = [
    "PIPELINE_MODE", "CONFIDENCE_THRESHOLD", "DEFAULT_PREDICTION",
    "ADD_EMBEDDING_KNN", "ADD_SETFIT", "ENABLE_CLEANING", "ENABLE_TRIMMING",
    "KNN_MODEL_NAME", "KNN_K", "KNN_MIN_SIMILARITY",
    "KNN_H_RATIO_THRESHOLD", "KNN_H_RATIO_STRICT", "KNN_SIMILARITY_PIVOT",
    "KNN_CONFIDENCE_SCALE", "KNN_ENCODE_BATCH_SIZE", "KNN_WEIGHT",
    "KNN_L_INDICATOR_PATTERNS",
    "SETFIT_MODEL_NAME", "SETFIT_NUM_EPOCHS", "SETFIT_BATCH_SIZE",
    "SETFIT_NUM_ITERATIONS", "SETFIT_MAX_STEPS", "SETFIT_FORCE_RETRAIN",
    "SETFIT_WEIGHT",
]

# Snapshot current config.py defaults at import time
_DEFAULTS = {}
for _k in _CONFIG_KEYS:
    _v = getattr(config, _k)
    _DEFAULTS[_k] = deepcopy(_v) if isinstance(_v, (list, dict)) else _v


def reset_config():
    """Restore all config values to their original defaults."""
    for key, value in _DEFAULTS.items():
        val = deepcopy(value) if isinstance(value, (list, dict)) else value
        setattr(config, key, val)


def apply_overrides(overrides: dict):
    """Apply experiment-specific overrides to the config module."""
    for key, value in overrides.items():
        if not hasattr(config, key):
            print(f"  WARNING: config has no attribute '{key}' — skipping")
            continue
        setattr(config, key, value)


# ═════════════════════════════════════════════════════════════════════════════
# PIPELINE BUILDING (reads from config module at call time)
# ═════════════════════════════════════════════════════════════════════════════

def build_references(df: pd.DataFrame) -> list:
    """Preprocess SEEN emails into reference dicts, honoring current config."""
    cleaner = HtmlCleaner()
    trimmer = EmailTrimmer()
    references = []

    if "IS_SEEN" in df.columns:
        seen_df = df[df["IS_SEEN"].astype(str).str.strip().str.upper() == "TRUE"].copy()
    else:
        seen_df = df.copy()

    for _, row in seen_df.iterrows():
        ctx = EmailContext(
            raw_body=str(row.get("EMAIL_BODY", "")),
            email_title=(
                str(row.get("EMAIL_TITLE", ""))
                if pd.notna(row.get("EMAIL_TITLE"))
                else None
            ),
            act_id=str(row.get("ACT_ID", "")),
            true_label=str(row.get("LABELLED_PRIORITY", "")).strip().upper(),
        )
        if config.ENABLE_CLEANING:
            cleaner.process(ctx)
        if config.ENABLE_TRIMMING:
            trimmer.process(ctx)
        text = ctx.dept_message or ctx.clean_text
        if text and text.strip() and ctx.true_label in ("H", "L"):
            references.append({"text": text, "label": ctx.true_label})

    return references


def build_pipeline(references: list) -> Pipeline:
    """Build a Pipeline using current config values."""
    pipe = Pipeline(
        mode=config.PIPELINE_MODE,
        confidence_threshold=config.CONFIDENCE_THRESHOLD,
    )
    if config.ENABLE_CLEANING:
        pipe.add_preprocessor(HtmlCleaner())
    if config.ENABLE_TRIMMING:
        pipe.add_preprocessor(EmailTrimmer())

    if config.ADD_EMBEDDING_KNN and references:
        knn = EmbeddingKNNClassifier(references=references)
        pipe.add_classifier(knn, weight=config.KNN_WEIGHT)

    if config.ADD_SETFIT and references:
        sf = SetFitClassifier(references=references)
        pipe.add_classifier(sf, weight=config.SETFIT_WEIGHT)

    return pipe


# ═════════════════════════════════════════════════════════════════════════════
# EXPERIMENT RUNNER
# ═════════════════════════════════════════════════════════════════════════════

def run_experiment(
    name: str, overrides: dict, df: pd.DataFrame, log_dir: str = None
) -> dict:
    """Run one experiment: reset → override → build → evaluate → return metrics."""
    reset_config()
    apply_overrides(overrides)

    print(f"\n{'─' * 60}")
    print(f"  Experiment: {name}")
    if overrides:
        for k, v in overrides.items():
            print(f"    {k} = {v}")
    else:
        print("    (all defaults)")
    print(f"{'─' * 60}")

    t0 = time.perf_counter()

    # Build references
    references = build_references(df)
    h_refs = sum(1 for r in references if r["label"] == "H")
    l_refs = sum(1 for r in references if r["label"] == "L")
    print(f"  References: {len(references)} ({h_refs} H, {l_refs} L)")

    # Build pipeline
    pipe = build_pipeline(references)
    print(f"  {pipe.describe()}")

    # Evaluate
    evaluator = Evaluator(pipe)
    evaluator.run(df)
    metrics = evaluator.metrics()
    elapsed = time.perf_counter() - t0

    # Save detailed logs
    if log_dir:
        exp_log_dir = os.path.join(log_dir, name)
        evaluator.save_logs(exp_log_dir)

    # Collect key metrics
    result = {
        "experiment": name,
        "overall_h_f1": metrics["overall"]["h_f1"],
        "seen_h_f1": metrics["seen"]["h_f1"],
        "inscope_h_f1": metrics["inscope"]["h_f1"],
        "outscope_h_f1": metrics["outscope"]["h_f1"],
        "overall_h_prec": metrics["overall"]["h_precision"],
        "overall_h_rec": metrics["overall"]["h_recall"],
        "fp": metrics["overall"]["fp_count"],
        "fn": metrics["overall"]["fn_count"],
        "runtime_s": round(elapsed, 1),
    }

    print(
        f"\n  >> Done in {elapsed:.1f}s  |  "
        f"Overall H-F1={result['overall_h_f1']:.4f}  |  "
        f"INSCOPE H-F1={result['inscope_h_f1']:.4f}  |  "
        f"FP={result['fp']}  FN={result['fn']}"
    )
    return result


# ═════════════════════════════════════════════════════════════════════════════
# OUTPUT
# ═════════════════════════════════════════════════════════════════════════════

def print_comparison_table(results: list):
    """Print a formatted comparison table sorted by INSCOPE H-F1."""
    W = 120
    print(f"\n\n{'=' * W}")
    print("                   CONFIGURATION TESTING — COMPARISON TABLE")
    print(f"{'=' * W}")

    header = (
        f"{'Experiment':<28s} | {'Ov H-F1':>8s} | {'SEEN':>8s} | "
        f"{'INSCOPE':>8s} | {'OUTSCOPE':>8s} | "
        f"{'H-Prec':>7s} | {'H-Rec':>7s} | {'FP':>3s} | {'FN':>3s} | {'Time':>6s}"
    )
    print(header)
    print(f"{'─' * W}")

    sorted_results = sorted(
        results, key=lambda r: r.get("inscope_h_f1", 0), reverse=True
    )

    for r in sorted_results:
        if "error" in r and r["error"]:
            print(f"{r['experiment']:<28s} | {'FAILED':>8s} | {r['error'][:80]}")
            continue
        print(
            f"{r['experiment']:<28s} | "
            f"{r['overall_h_f1']:8.4f} | "
            f"{r['seen_h_f1']:8.4f} | "
            f"{r['inscope_h_f1']:8.4f} | "
            f"{r['outscope_h_f1']:8.4f} | "
            f"{r['overall_h_prec']:7.4f} | "
            f"{r['overall_h_rec']:7.4f} | "
            f"{r['fp']:3d} | "
            f"{r['fn']:3d} | "
            f"{r['runtime_s']:5.1f}s"
        )

    print(f"{'=' * W}")

    valid = [r for r in sorted_results if not r.get("error")]
    if valid:
        best_inscope = max(valid, key=lambda r: r["inscope_h_f1"])
        best_overall = max(valid, key=lambda r: r["overall_h_f1"])
        print(
            f"\n  Best INSCOPE H-F1:  {best_inscope['experiment']} "
            f"({best_inscope['inscope_h_f1']:.4f})"
        )
        print(
            f"  Best OVERALL H-F1:  {best_overall['experiment']} "
            f"({best_overall['overall_h_f1']:.4f})"
        )


# ═════════════════════════════════════════════════════════════════════════════
# DATA LOADING
# ═════════════════════════════════════════════════════════════════════════════

def load_data(path: str) -> pd.DataFrame:
    """Load and validate the email dataset."""
    if path.endswith(".csv"):
        df = pd.read_csv(path, encoding="utf-8-sig")
    else:
        df = pd.read_excel(path)

    df.columns = [c.strip().replace(" ", "_").upper() for c in df.columns]

    for col in ["EMAIL_BODY", "LABELLED_PRIORITY"]:
        assert col in df.columns, f"Missing required column: {col}"

    if "EMAIL_TITLE" not in df.columns:
        df["EMAIL_TITLE"] = ""
    if "ACT_ID" not in df.columns:
        df["ACT_ID"] = range(len(df))

    df["EMAIL_BODY"] = df["EMAIL_BODY"].fillna("")
    df["EMAIL_TITLE"] = df["EMAIL_TITLE"].fillna("")
    df["ACT_ID"] = df["ACT_ID"].astype(str)
    return df


def find_data_file() -> str:
    """Auto-detect a data file in test_cases/ or current directory."""
    for directory in ["test_cases", "."]:
        for pattern in ["*.xlsx", "*.xls", "*.csv"]:
            files = glob.glob(os.path.join(directory, pattern))
            if files:
                return files[0]
    raise FileNotFoundError(
        "No data file found. Pass the path as a command-line argument."
    )


# ═════════════════════════════════════════════════════════════════════════════
# MAIN
# ═════════════════════════════════════════════════════════════════════════════

def main():
    # ── Load data ──
    if len(sys.argv) > 1:
        data_path = sys.argv[1]
    else:
        data_path = find_data_file()

    print(f"Loading data from: {data_path}")
    df = load_data(data_path)
    print(f"Loaded {len(df)} emails")

    # ── Create log directory ──
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_dir = os.path.join("logs", f"config_testing_{timestamp}")
    os.makedirs(log_dir, exist_ok=True)
    print(f"Logs → {log_dir}/")

    # ── Run all experiments ──
    all_results = []
    total = len(EXPERIMENTS)
    wall_start = time.perf_counter()

    for i, (name, overrides) in enumerate(EXPERIMENTS, 1):
        print(f"\n{'═' * 60}")
        print(f"  [{i}/{total}]  {name}")
        print(f"{'═' * 60}")

        try:
            result = run_experiment(name, overrides, df, log_dir=log_dir)
            all_results.append(result)
        except Exception as e:
            print(f"\n  FAILED: {e}")
            all_results.append({
                "experiment": name,
                "error": str(e),
                "overall_h_f1": 0, "seen_h_f1": 0,
                "inscope_h_f1": 0, "outscope_h_f1": 0,
                "overall_h_prec": 0, "overall_h_rec": 0,
                "fp": -1, "fn": -1, "runtime_s": 0,
            })

    wall_elapsed = time.perf_counter() - wall_start

    # ── Print comparison table ──
    print_comparison_table(all_results)
    print(f"\n  Total wall time: {wall_elapsed / 60:.1f} minutes")

    # ── Save summary CSV ──
    summary_df = pd.DataFrame(all_results)
    summary_path = os.path.join(log_dir, "summary.csv")
    summary_df.to_csv(summary_path, index=False)
    print(f"  Summary CSV  → {summary_path}")

    # ── Save experiment definitions (for reproducibility) ──
    exp_def_path = os.path.join(log_dir, "experiment_definitions.json")
    with open(exp_def_path, "w") as f:
        json.dump(
            {name: overrides for name, overrides in EXPERIMENTS},
            f, indent=2, default=str,
        )
    print(f"  Definitions  → {exp_def_path}")

    # ── Restore defaults ──
    reset_config()
    print("\nConfig restored to defaults. Done.")


if __name__ == "__main__":
    main()
