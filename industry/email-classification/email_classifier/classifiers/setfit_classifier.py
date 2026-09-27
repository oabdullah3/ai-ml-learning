"""
SetFit Classifier.

Fine-tunes a sentence-transformer model using contrastive learning on
the SEEN reference examples, then classifies via a lightweight head.

How it works:
  1. Takes the same reference dicts as embedding_knn:
     [{"text": "...", "label": "H"}, ...]
  2. Fine-tunes the base sentence-transformer so that H-texts cluster
     together and L-texts cluster together in embedding space.
  3. Trains a logistic regression head on the tuned embeddings.
  4. At inference: encode text → head predicts H/L with probability.

Key advantages over raw k-NN:
  - Learns domain-specific distinctions (e.g. "reassignment" vs
    "acknowledgment") from just 130 labeled examples.
  - No neighbor search at inference — single forward pass + head.
  - Typically +10-20% F1 over k-NN in few-shot settings.

Falls back to clean_text when dept_message is empty, same as k-NN.

Requires: pip install setfit
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

from datasets import Dataset
from setfit import SetFitModel, Trainer, TrainingArguments

from email_classifier.core import Classifier, EmailContext, ClassificationResult
from email_classifier import config


# Where to cache trained models (relative to project root)
DEFAULT_CACHE_DIR = Path(__file__).resolve().parent.parent.parent / "models" / "setfit_cache"

# Label mapping
_LABEL_TO_INT = {"L": 0, "H": 1}
_INT_TO_LABEL = {0: "L", 1: "H"}


def _references_fingerprint(references: list[dict], model_name: str, **train_kwargs) -> str:
    """
    Deterministic hash of references + training config.
    If either changes, we retrain.
    """
    payload = json.dumps(
        {"refs": references, "model": model_name, **train_kwargs},
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


class SetFitClassifier(Classifier):
    """
    Classify emails using a SetFit-finetuned sentence-transformer.

    The trained model is cached to disk.  On subsequent runs, if the
    reference data and training config haven't changed, the cached
    model is loaded instantly (no retraining).

    To force retraining, either:
      - pass ``force_retrain=True``
      - delete the ``models/setfit_cache/`` directory

    Usage:
        refs = [
            {"text": "Please reassign this case...", "label": "H"},
            {"text": "We have taken follow-up action...", "label": "L"},
        ]
        clf = SetFitClassifier(references=refs)
        pipeline.add_classifier(clf)
    """

    def __init__(
        self,
        references: list[dict],
        model_name: str = None,
        num_epochs: int = None,
        batch_size: int = None,
        num_iterations: int = None,
        max_steps: int = None,
        force_retrain: bool = None,
        cache_dir: Path | str | None = None,
    ):
        """
        All parameters default to their config.py values when None.
        Pass explicit values here to override config for this instance only.
        """
        model_name = model_name if model_name is not None else config.SETFIT_MODEL_NAME
        num_epochs = num_epochs if num_epochs is not None else config.SETFIT_NUM_EPOCHS
        batch_size = batch_size if batch_size is not None else config.SETFIT_BATCH_SIZE
        num_iterations = num_iterations if num_iterations is not None else config.SETFIT_NUM_ITERATIONS
        max_steps = max_steps if max_steps is not None else config.SETFIT_MAX_STEPS
        force_retrain = force_retrain if force_retrain is not None else config.SETFIT_FORCE_RETRAIN
        self._cache_dir = Path(cache_dir) if cache_dir else DEFAULT_CACHE_DIR

        # Fingerprint the data + config so we retrain only when something changes
        fp = _references_fingerprint(
            references, model_name,
            num_epochs=num_epochs, batch_size=batch_size,
            num_iterations=num_iterations, max_steps=max_steps,
        )
        model_path = self._cache_dir / fp

        if not force_retrain and model_path.exists():
            # --- Load cached model (instant) ---
            print(f"  SetFit: loading cached model from {model_path}")
            self._model = SetFitModel.from_pretrained(str(model_path))
            print("  SetFit: cached model loaded (no training needed).")
        else:
            # --- Train from scratch ---
            print(f"  SetFit: loading base model {model_name}...")
            self._model = SetFitModel.from_pretrained(model_name)

            texts = [r["text"] for r in references]
            labels = [_LABEL_TO_INT[r["label"]] for r in references]
            train_ds = Dataset.from_dict({"text": texts, "label": labels})

            h_count = sum(1 for l in labels if l == 1)
            l_count = sum(1 for l in labels if l == 0)
            print(f"  SetFit: training on {len(references)} examples ({h_count} H, {l_count} L)")
            print(f"  SetFit: epochs={num_epochs}, iters={num_iterations}, batch={batch_size}, max_steps={max_steps}")

            args = TrainingArguments(
                num_epochs=num_epochs,
                batch_size=batch_size,
                num_iterations=num_iterations,
                max_steps=max_steps,
            )

            trainer = Trainer(
                model=self._model,
                args=args,
                train_dataset=train_ds,
            )
            trainer.train()

            # Save to cache
            model_path.mkdir(parents=True, exist_ok=True)
            self._model.save_pretrained(str(model_path))
            print(f"  SetFit: training complete. Model cached at {model_path}")

    @property
    def name(self) -> str:
        return "setfit"

    def classify(self, ctx: EmailContext) -> ClassificationResult:
        # --- Text selection with fallback (same logic as k-NN) ---
        text = ctx.dept_message.strip() if ctx.dept_message else ""
        text_source = "dept_message"
        if not text:
            text = ctx.clean_text.strip() if ctx.clean_text else ""
            text_source = "clean_text"
        if not text:
            return ClassificationResult(
                prediction=None,
                confidence=0.0,
                reason="No text to analyze (dept_message and clean_text both empty)",
                classifier_name=self.name,
            )

        # Predict
        preds = self._model.predict([text])
        probs = self._model.predict_proba([text])

        pred_int = int(preds[0])
        prediction = _INT_TO_LABEL[pred_int]

        # probs shape: [[prob_L, prob_H]]
        prob_arr = probs[0]
        confidence = float(prob_arr[pred_int])
        confidence = min(confidence, 0.95)  # cap like other classifiers

        prob_h = float(prob_arr[1])
        prob_l = float(prob_arr[0])

        reason = (
            f"SetFit: {prediction} "
            f"(prob_H={prob_h:.3f}, prob_L={prob_l:.3f}), "
            f"src={text_source}"
        )

        return ClassificationResult(
            prediction=prediction,
            confidence=confidence,
            reason=reason,
            classifier_name=self.name,
            details={
                "prob_H": prob_h,
                "prob_L": prob_l,
                "text_source": text_source,
            },
        )
