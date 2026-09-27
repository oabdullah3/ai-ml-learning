"""
Pipeline -- orchestrates preprocessing and classification of emails.

Design:
    - Preprocessors run in order, each modifying the EmailContext
    - Classifiers run according to the pipeline mode:
        - 'first_confident': first classifier with confidence >= threshold decides
        - 'weighted_ensemble': all classifiers vote, weighted by confidence
    - Results are collected into a PipelineResult for logging/evaluation
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

from email_classifier.core import (
    EmailContext,
    ClassificationResult,
    Preprocessor,
    Classifier,
)
from email_classifier.config import (
    PIPELINE_MODE,
    CONFIDENCE_THRESHOLD,
    DEFAULT_PREDICTION,
)


@dataclass
class PipelineResult:
    """Full result from running the pipeline on one email."""
    act_id: str
    true_label: Optional[str]
    final_prediction: str
    final_confidence: float
    final_reason: str
    deciding_classifier: str
    context: EmailContext
    classifier_results: List[ClassificationResult] = field(default_factory=list)

    @property
    def is_correct(self) -> Optional[bool]:
        if self.true_label is None:
            return None
        return self.final_prediction == self.true_label

    def summary_dict(self) -> dict:
        """Flat dictionary for CSV logging."""
        return {
            'act_id': self.act_id,
            'true_label': self.true_label,
            'prediction': self.final_prediction,
            'is_correct': self.is_correct,
            'confidence': self.final_confidence,
            'deciding_classifier': self.deciding_classifier,
            'reason': self.final_reason,
            'format_type': self.context.format_type,
            'boundary_marker': self.context.boundary_marker or '',
            'dept_msg_len': len(self.context.dept_message),
            'dept_msg_preview': self.context.dept_message[:200],
            'reply_slip_codes': ','.join(
                k for k, v in self.context.filled_codes.items() if v
            ),
            'classifier_details': ' | '.join(
                f"{cr.classifier_name}:{cr.prediction}@{cr.confidence:.2f}"
                for cr in self.classifier_results
            ),
        }


class Pipeline:
    """
    Modular email classification pipeline.

    Usage:
        pipe = Pipeline()
        pipe.add_preprocessor(HtmlCleaner())
        pipe.add_preprocessor(EmailTrimmer())
        pipe.add_classifier(KeywordScorer(), weight=1.0)
        pipe.add_classifier(knn_clf, weight=1.5)
        result = pipe.classify_email(raw_body="...", act_id="123")
    """

    def __init__(
        self,
        mode: str = PIPELINE_MODE,
        confidence_threshold: float = CONFIDENCE_THRESHOLD,
    ):
        self.mode = mode
        self.confidence_threshold = confidence_threshold
        self.preprocessors: List[Preprocessor] = []
        self.classifiers: List[tuple] = []  # (Classifier, weight)

    def add_preprocessor(self, preprocessor: Preprocessor) -> 'Pipeline':
        self.preprocessors.append(preprocessor)
        return self

    def add_classifier(self, classifier: Classifier, weight: float = 1.0) -> 'Pipeline':
        """Add a classifier with optional weight (used in ensemble mode)."""
        self.classifiers.append((classifier, weight))
        return self

    def classify_email(
        self,
        raw_body: str,
        email_title: str = None,
        act_id: str = "",
        true_label: str = None,
    ) -> PipelineResult:
        # Build context using core.EmailContext
        ctx = EmailContext(
            raw_body=raw_body,
            email_title=email_title,
            act_id=act_id,
            true_label=true_label,
        )

        # Run preprocessors
        for preprocessor in self.preprocessors:
            preprocessor.process(ctx)

        # Run classifiers and collect results
        classifier_results: List[ClassificationResult] = []
        for classifier, weight in self.classifiers:
            result = classifier.classify(ctx)
            result.details['weight'] = weight
            classifier_results.append(result)

        # Decide final prediction based on mode
        if self.mode == 'weighted_ensemble':
            return self._weighted_ensemble(ctx, classifier_results)
        else:
            # default to first_confident
            return self._first_confident(ctx, classifier_results)

    # -----------------------------------------------------------------
    # first_confident: first classifier above threshold decides
    # -----------------------------------------------------------------
    def _first_confident(
        self, ctx: EmailContext, results: List[ClassificationResult]
    ) -> PipelineResult:
        for cr in results:
            if cr.confidence >= self.confidence_threshold:
                return PipelineResult(
                    act_id=ctx.act_id,
                    true_label=ctx.true_label,
                    final_prediction=cr.prediction,
                    final_confidence=cr.confidence,
                    final_reason=cr.reason,
                    deciding_classifier=cr.classifier_name,
                    context=ctx,
                    classifier_results=results,
                )

        # No classifier was confident enough
        return PipelineResult(
            act_id=ctx.act_id,
            true_label=ctx.true_label,
            final_prediction=DEFAULT_PREDICTION,
            final_confidence=0.0,
            final_reason=f"No classifier reached confidence threshold ({self.confidence_threshold})",
            deciding_classifier='default',
            context=ctx,
            classifier_results=results,
        )

    # -----------------------------------------------------------------
    # weighted_ensemble: all classifiers vote, weighted by conf * weight
    # -----------------------------------------------------------------
    def _weighted_ensemble(
        self, ctx: EmailContext, results: List[ClassificationResult]
    ) -> PipelineResult:
        """
        Each classifier contributes:
            score += confidence * classifier_weight
        to the H or L bucket.  Whichever bucket is larger wins.
        """
        h_score = 0.0
        l_score = 0.0
        reasons = []

        for cr in results:
            w = cr.details.get('weight', 1.0)
            weighted_conf = cr.confidence * w

            if cr.prediction == 'H':
                h_score += weighted_conf
                reasons.append(f"{cr.classifier_name}:H@{cr.confidence:.2f}*{w}")
            else:
                l_score += weighted_conf
                reasons.append(f"{cr.classifier_name}:L@{cr.confidence:.2f}*{w}")

        total = h_score + l_score
        if total == 0:
            return PipelineResult(
                act_id=ctx.act_id,
                true_label=ctx.true_label,
                final_prediction=DEFAULT_PREDICTION,
                final_confidence=0.0,
                final_reason="No classifier produced any signal",
                deciding_classifier='default',
                context=ctx,
                classifier_results=results,
            )

        if h_score > l_score:
            final_pred = 'H'
            final_conf = h_score / total
        elif l_score > h_score:
            final_pred = 'L'
            final_conf = l_score / total
        else:
            # Tie -- default to L
            final_pred = DEFAULT_PREDICTION
            final_conf = 0.5

        reason_str = f"Ensemble: H={h_score:.2f} vs L={l_score:.2f} [{', '.join(reasons)}]"

        # Find the top contributor on the winning side
        best_contributor = 'ensemble'
        best_contrib_score = 0.0
        for cr in results:
            w = cr.details.get('weight', 1.0)
            if cr.prediction == final_pred and (cr.confidence * w) > best_contrib_score:
                best_contrib_score = cr.confidence * w
                best_contributor = cr.classifier_name

        return PipelineResult(
            act_id=ctx.act_id,
            true_label=ctx.true_label,
            final_prediction=final_pred,
            final_confidence=final_conf,
            final_reason=reason_str,
            deciding_classifier=best_contributor,
            context=ctx,
            classifier_results=results,
        )

    # -----------------------------------------------------------------
    # describe
    # -----------------------------------------------------------------
    def describe(self) -> str:
        """Human-readable description of the pipeline configuration."""
        lines = [f"Pipeline (mode={self.mode}, confidence_threshold={self.confidence_threshold})"]
        if self.preprocessors:
            lines.append(f"  Preprocessors ({len(self.preprocessors)}):")
            for i, p in enumerate(self.preprocessors, 1):
                lines.append(f"    {i}. {p.name}")
        lines.append(f"  Classifiers ({len(self.classifiers)}):")
        for i, (c, w) in enumerate(self.classifiers, 1):
            lines.append(f"    {i}. {c.name} (weight={w})")
        return '\n'.join(lines)
