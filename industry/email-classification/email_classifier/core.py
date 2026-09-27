"""
Core types and base classes for the Email Priority Classifier pipeline.

EmailContext: carries all data about an email through the pipeline.
ClassificationResult: the output of a classifier.
Preprocessor / Classifier: abstract base classes for pipeline components.
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Optional


# =============================================================================
# Data containers
# =============================================================================

@dataclass
class EmailContext:
    """
    Carries all data about a single email through the pipeline.

    Preprocessors enrich this object (add cleaned text, extracted dept message, etc.)
    Classifiers read from it to make a decision.
    """
    # --- Raw input ---
    raw_body: str                          # Original EMAIL_BODY from CSV/Excel
    email_title: Optional[str] = None      # EMAIL_TITLE (often null)
    act_id: str = ""                       # Case ID for logging
    true_label: Optional[str] = None       # Ground truth H/L (None for unlabeled)

    # --- Populated by preprocessors ---
    clean_text: str = ""                   # HTML-stripped full text
    dept_message: str = ""                 # Extracted department message (above template)
    template_text: str = ""                # The hotline template portion (below boundary)
    boundary_marker: Optional[str] = None  # Which marker was used to split
    boundary_position: Optional[int] = None  # Char position of boundary in clean_text
    format_type: str = ""                  # full_html / partial_html / plain_text / cmis

    # --- Populated by classifiers ---
    filled_codes: dict = field(default_factory=dict)  # {code_name: True/False}

    # --- Extensible metadata ---
    metadata: dict = field(default_factory=dict)  # Any extra data preprocessors/classifiers want to attach


@dataclass
class ClassificationResult:
    """
    Output of a single classifier component.

    prediction: 'H', 'L', or None (abstain — classifier can't decide)
    confidence: 0.0 to 1.0 (how sure this classifier is)
    reason: human-readable explanation for logging
    classifier_name: which classifier produced this
    details: any extra data for logging/debugging
    """
    prediction: Optional[str]              # 'H', 'L', or None
    confidence: float = 0.0                # 0.0 = no idea, 1.0 = certain
    reason: str = ""                       # Explanation
    classifier_name: str = ""              # Name of the classifier
    details: dict = field(default_factory=dict)  # Extra debug info


# =============================================================================
# Base classes
# =============================================================================

class Preprocessor(ABC):
    """
    Abstract base for preprocessors.

    A preprocessor transforms/enriches an EmailContext in-place.
    It does NOT classify — it just prepares data.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique name for this preprocessor (used in logs)."""
        ...

    @abstractmethod
    def process(self, ctx: EmailContext) -> None:
        """
        Enrich the EmailContext in-place.

        Args:
            ctx: The email context to enrich. Modify its fields directly.
        """
        ...


class Classifier(ABC):
    """
    Abstract base for classifiers.

    A classifier reads from an EmailContext and returns a ClassificationResult.
    It should NOT modify the EmailContext (except metadata for logging).
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique name for this classifier (used in logs and pipeline config)."""
        ...

    @abstractmethod
    def classify(self, ctx: EmailContext) -> ClassificationResult:
        """
        Classify an email.

        Args:
            ctx: The preprocessed email context.

        Returns:
            ClassificationResult with prediction, confidence, and reasoning.
        """
        ...
