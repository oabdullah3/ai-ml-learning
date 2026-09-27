"""
Embedding k-NN Classifier.

Uses a pretrained multilingual sentence embedding model to encode the
department message, then classifies by majority vote of the k nearest
labeled reference examples.

No training step — the reference embeddings are computed once at init
and stored in memory.  Classification is a simple cosine similarity
lookup.

Key design choices:
  - Falls back to clean_text when dept_message is empty (avoids
    garbage predictions from empty-string embeddings).
  - H-margin threshold: requires a supermajority of H-evidence to
    predict H, encoding the prior that most emails are L.
  - Similarity-weighted voting: closer neighbors count more.
  - Low-similarity guard: abstains when neighbors are too distant
    (avg_sim below min_similarity).

Requires: pip install sentence-transformers
"""

from __future__ import annotations

import re
import numpy as np
from sentence_transformers import SentenceTransformer

from email_classifier.core import Classifier, EmailContext, ClassificationResult
from email_classifier import config


def _compile_l_indicators() -> list:
    """Compile L-indicator regex patterns from config."""
    return [re.compile(p, re.IGNORECASE) for p in config.KNN_L_INDICATOR_PATTERNS]


def _compile_h_indicators() -> list:
    """Compile H-indicator regex patterns from config."""
    return [re.compile(p, re.IGNORECASE) for p in config.KNN_H_INDICATOR_PATTERNS]


class EmbeddingKNNClassifier(Classifier):
    """
    Classify emails by finding the most similar labeled reference
    examples using sentence embeddings + cosine k-NN.

    Usage:
        refs = [
            {"text": "Please reassign this case...", "label": "H"},
            {"text": "We have taken follow-up action...", "label": "L"},
        ]
        clf = EmbeddingKNNClassifier(references=refs, k=5)
        pipeline.add_classifier(clf)
    """

    def __init__(
        self,
        references: list[dict],
        k: int = None,
        model_name: str = None,
        confidence_threshold: float = None,
        min_similarity: float = None,
        h_ratio_threshold: float = None,
        h_ratio_strict: float = None,
        similarity_pivot: float = None,
        encode_batch_size: int = None,
    ):
        """
        All parameters default to their config.py values when None.
        Pass explicit values here to override config for this instance only.
        """
        k = k if k is not None else config.KNN_K
        model_name = model_name if model_name is not None else config.KNN_MODEL_NAME
        confidence_threshold = confidence_threshold if confidence_threshold is not None else config.KNN_CONFIDENCE_SCALE
        min_similarity = min_similarity if min_similarity is not None else config.KNN_MIN_SIMILARITY
        h_ratio_threshold = h_ratio_threshold if h_ratio_threshold is not None else config.KNN_H_RATIO_THRESHOLD
        h_ratio_strict = h_ratio_strict if h_ratio_strict is not None else config.KNN_H_RATIO_STRICT
        similarity_pivot = similarity_pivot if similarity_pivot is not None else config.KNN_SIMILARITY_PIVOT
        encode_batch_size = encode_batch_size if encode_batch_size is not None else config.KNN_ENCODE_BATCH_SIZE
        self._k = k
        self._confidence_threshold = confidence_threshold
        self._min_similarity = min_similarity
        self._h_ratio_threshold = h_ratio_threshold
        self._h_ratio_strict = h_ratio_strict
        self._similarity_pivot = similarity_pivot

        # Compile indicator patterns from config
        self._l_indicators = _compile_l_indicators()
        self._h_indicators = _compile_h_indicators()
        self._h_ratio_lenient = config.KNN_H_RATIO_LENIENT

        # Load model
        print(f"  Loading embedding model: {model_name}...")
        self._model = SentenceTransformer(model_name)

        # Build reference embeddings
        self._ref_texts = [r["text"] for r in references]
        self._ref_labels = [r["label"] for r in references]

        print(f"  Encoding {len(self._ref_texts)} reference examples...")
        self._ref_embeddings = self._model.encode(
            self._ref_texts,
            normalize_embeddings=True,  # MUST be True — cosine sim via dot product
            show_progress_bar=False,
            batch_size=encode_batch_size,
        )

        # Report reference set composition (no class weights — margin threshold
        # handles the L-prior instead of reweighting).
        h_count = sum(1 for l in self._ref_labels if l == "H")
        l_count = sum(1 for l in self._ref_labels if l == "L")
        total = h_count + l_count
        print(f"  Reference set: {h_count} H, {l_count} L ({total} total)")
        print(f"  H-ratio threshold: {self._h_ratio_threshold:.2f} (lenient, avg_sim>={self._similarity_pivot}) / {self._h_ratio_strict:.2f} (strict)")
        print(f"  Min similarity: {self._min_similarity:.2f}")

    @property
    def name(self) -> str:
        return "embedding_knn"

    def classify(self, ctx: EmailContext) -> ClassificationResult:
        # --- Text selection with proper fallback ---
        # Prefer dept_message (trimmed). If empty/whitespace-only, fall back
        # to full clean_text so we never embed an empty string.
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

        # Encode the input
        query_embedding = self._model.encode(
            [text],
            normalize_embeddings=True,
            show_progress_bar=False,
        )[0]

        # Cosine similarity (dot product since embeddings are normalized)
        similarities = self._ref_embeddings @ query_embedding

        # Get top-k indices
        top_k_idx = np.argsort(similarities)[-self._k:][::-1]
        top_k_labels = [self._ref_labels[i] for i in top_k_idx]
        top_k_sims = [float(similarities[i]) for i in top_k_idx]
        avg_sim = float(np.mean(top_k_sims))

        # --- Low-similarity guard: abstain if neighbors are too distant ---
        if avg_sim < self._min_similarity:
            return ClassificationResult(
                prediction=None,
                confidence=0.0,
                reason=f"Neighbors too distant (avg_sim={avg_sim:.3f} < {self._min_similarity})",
                classifier_name=self.name,
                details={"avg_similarity": avg_sim, "text_source": text_source},
            )

        # --- Similarity-weighted voting (no class reweighting) ---
        h_weight = 0.0
        l_weight = 0.0
        for label, sim in zip(top_k_labels, top_k_sims):
            if label == "H":
                h_weight += sim
            else:
                l_weight += sim

        total_weight = h_weight + l_weight

        if total_weight == 0:
            prediction = None
            confidence = 0.0
            has_l_indicator = False
            effective_threshold = self._h_ratio_threshold
        else:
            h_ratio = h_weight / total_weight

            # --- Adaptive H-threshold ---
            # Check for indicator phrases in the text.
            # H-indicators (reassignment language) → use lenient threshold
            # L-indicators (handling language) → use strict threshold
            # H-indicators take priority over L-indicators when both match.
            has_l_indicator = any(p.search(text) for p in self._l_indicators)
            has_h_indicator = any(p.search(text) for p in self._h_indicators)

            if has_h_indicator:
                # Text contains explicit reassignment language → lenient threshold
                effective_threshold = self._h_ratio_lenient
            elif has_l_indicator:
                # Text contains L-indicator → use strict threshold
                effective_threshold = self._h_ratio_strict
            elif avg_sim >= self._similarity_pivot:
                # High similarity, no indicators → normal threshold
                effective_threshold = self._h_ratio_threshold
            else:
                # Low similarity, no indicators → strict threshold
                effective_threshold = self._h_ratio_strict

            if h_ratio >= effective_threshold:
                prediction = "H"
                confidence = h_ratio
            else:
                prediction = "L"
                confidence = 1.0 - h_ratio

        # Scale confidence by average similarity (distant neighbors = less certain)
        confidence = confidence * min(avg_sim / self._confidence_threshold, 1.0)
        confidence = min(confidence, 0.95)

        # Build reason string
        vote_str = "".join(top_k_labels)  # e.g. "HHLLL"
        nearest_preview = self._ref_texts[top_k_idx[0]][:80]
        ind_tag = " [H-ind]" if has_h_indicator else (" [L-ind]" if has_l_indicator else "")
        reason = (
            f"k-NN vote: {vote_str} "
            f"(H={h_weight:.2f}, L={l_weight:.2f}), "
            f"avg_sim={avg_sim:.3f}, thr={effective_threshold:.2f}{ind_tag}, "
            f"src={text_source}, "
            f"nearest: \"{nearest_preview}\""
        )

        return ClassificationResult(
            prediction=prediction,
            confidence=confidence,
            reason=reason,
            classifier_name=self.name,
            details={
                "top_k_labels": top_k_labels,
                "top_k_similarities": top_k_sims,
                "h_weight": h_weight,
                "l_weight": l_weight,
                "h_ratio": h_weight / total_weight if total_weight else 0,
                "h_ratio_threshold": effective_threshold if total_weight else self._h_ratio_threshold,
                "avg_similarity": avg_sim,
                "text_source": text_source,
                "has_l_indicator": has_l_indicator,
                "has_h_indicator": has_h_indicator,
            },
        )
