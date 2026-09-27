"""
LLM Classifier (OpenRouter API).

Sends the department message to a large language model via OpenRouter
and parses the structured JSON response into a ClassificationResult.

Key design choices:
  - System prompt is fully configurable from config.py (no hardcoded
    domain knowledge in this file).
  - Falls back to clean_text when dept_message is empty, same as k-NN
    and SetFit.
  - Truncates input to avoid token limits and reduce cost.
  - Returns prediction=None on API errors so the pipeline gracefully
    falls back to other classifiers or the default prediction.

Requires: pip install requests
"""

from __future__ import annotations

import json
import logging
import os
import time

import requests

logger = logging.getLogger(__name__)

from email_classifier.core import Classifier, EmailContext, ClassificationResult
from email_classifier import config


# Maximum characters of email text to send to the LLM.
# ~4 chars ≈ 1 token; 3000 chars ≈ 750 tokens — well within most model limits.
_MAX_INPUT_CHARS = 3000


class LLMClassifier(Classifier):
    """
    Classify emails by prompting an LLM via the OpenRouter API.

    All configuration (model, prompts, API key, weights) is read from
    config.py at construction time.  Nothing is hardcoded here.

    Usage:
        clf = LLMClassifier()
        pipeline.add_classifier(clf, weight=config.LLM_WEIGHT)
    """

    def __init__(
        self,
        api_key: str = None,
        api_base: str = None,
        model: str = None,
        max_tokens: int = None,
        temperature: float = None,
        timeout: float = None,
        system_prompt: str = None,
        user_prompt: str = None,
    ):
        self._api_key = (
            api_key
            or os.environ.get("OPENROUTER_API_KEY")
            or config.LLM_API_KEY
        )
        if not self._api_key:
            raise ValueError(
                "No OpenRouter API key found. Set OPENROUTER_API_KEY env var "
                "or config.LLM_API_KEY."
            )

        self._api_base = api_base or config.LLM_API_BASE
        self._model = model or config.LLM_MODEL
        self._max_tokens = max_tokens if max_tokens is not None else config.LLM_MAX_TOKENS
        self._temperature = temperature if temperature is not None else config.LLM_TEMPERATURE
        self._timeout = timeout if timeout is not None else config.LLM_TIMEOUT
        self._max_retries = config.LLM_MAX_RETRIES
        self._retry_delay = config.LLM_RETRY_DELAY

        # Build system prompt with class-name placeholders filled in
        raw_sys = system_prompt or config.LLM_SYSTEM_PROMPT
        self._system_prompt = raw_sys.format(label_h="H", label_l="L")

        self._user_prompt_template = user_prompt or config.LLM_USER_PROMPT

        print(f"  [LLMClassifier] model={self._model}, temp={self._temperature}")

    @property
    def name(self) -> str:
        return "llm"

    @staticmethod
    def _mark_error(ctx: EmailContext, reason: str) -> None:
        """Stamp the email context so evaluator can exclude this row from metrics."""
        ctx.metadata['llm_error'] = True
        ctx.metadata['llm_error_reason'] = reason

    def classify(self, ctx: EmailContext) -> ClassificationResult:
        # --- Text selection with fallback ---
        text = ctx.dept_message.strip() if ctx.dept_message else ""
        text_source = "dept_message"
        if not text:
            text = ctx.clean_text.strip() if ctx.clean_text else ""
            text_source = "clean_text"
        if not text:
            self._mark_error(ctx, "no_text")
            return ClassificationResult(
                prediction=None,
                confidence=0.0,
                reason="No text to analyze",
                classifier_name=self.name,
            )

        # Truncate to keep within token limits
        if len(text) > _MAX_INPUT_CHARS:
            text = text[:_MAX_INPUT_CHARS] + "..."

        user_msg = self._user_prompt_template.format(text=text)

        act_id = ctx.act_id or "?"
        print(f"  [LLM] {act_id} -> calling {self._model} ({len(text)} chars, src={text_source})")

        # --- API call with retries ---
        data = self._call_api(user_msg, text_source, act_id)
        if data is None:
            self._mark_error(ctx, "api_failed")
            print(f"  [LLM] {act_id} -> FAILED (all retries exhausted) — row marked LLM_ERROR")
            return ClassificationResult(
                prediction=None,
                confidence=0.0,
                reason="LLM_ERROR: API failed after retries",
                classifier_name=self.name,
                details={"text_source": text_source, "llm_error": True},
            )

        # --- Parse response ---
        choice = data.get("choices", [{}])[0]
        message = choice.get("message", {})
        raw_content = (message.get("content") or "").strip()

        if not raw_content:
            finish = choice.get("finish_reason")
            # Reasoning models (e.g. nemotron) put chain-of-thought in
            # "reasoning" and leave content=null — that text is NOT the answer.
            has_reasoning = bool(message.get("reasoning"))
            note = " (reasoning-only model — use a non-reasoning model)" if has_reasoning else ""
            self._mark_error(ctx, f"empty_content:{finish}")
            print(f"  [LLM] {act_id} -> empty content (finish_reason={finish}){note} — row marked LLM_ERROR")
            logger.warning("[LLM] Empty response from model (finish_reason=%s)", finish)
            return ClassificationResult(
                prediction=None,
                confidence=0.0,
                reason=f"LLM_ERROR: empty response (finish_reason={finish})",
                classifier_name=self.name,
                details={"finish_reason": finish, "text_source": text_source, "llm_error": True},
            )

        result = self._parse_response(raw_content, text_source)
        # If the response was unparseable, mark as error too
        if result.prediction is None:
            self._mark_error(ctx, "unparseable_response")
        label = result.prediction if result.prediction else "LLM_ERROR"
        print(f"  [LLM] {act_id} -> prediction={label}, confidence={result.confidence:.2f}")
        return result

    # --------------------------------------------------------------------- #
    #  API call with retry logic                                             #
    # --------------------------------------------------------------------- #

    def _call_api(self, user_msg: str, text_source: str, act_id: str = "?") -> dict | None:
        """
        POST to the OpenRouter API with retry on transient failures.

        Retries on: timeouts, connection errors, HTTP 429 (rate-limit),
        and HTTP 5xx (server errors).  Returns parsed JSON dict on success
        or None after all attempts are exhausted (silent fallback).
        """
        payload = {
            "model": self._model,
            "max_tokens": self._max_tokens,
            "temperature": self._temperature,
            "messages": [
                {"role": "system", "content": self._system_prompt},
                {"role": "user", "content": user_msg},
            ],
        }
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

        last_error = None
        for attempt in range(1 + self._max_retries):
            try:
                resp = requests.post(
                    self._api_base,
                    json=payload,
                    headers=headers,
                    timeout=self._timeout,
                )

                # Retryable HTTP codes: 429 rate-limit, 5xx server error
                if resp.status_code == 429 or resp.status_code >= 500:
                    last_error = f"HTTP {resp.status_code}: {resp.text[:200]}"
                    if attempt < self._max_retries:
                        delay = self._retry_delay * (2 ** attempt)
                        print(f"  [LLM] {act_id} -> {last_error} — retry {attempt + 1}/{self._max_retries} in {delay:.1f}s")
                        logger.info("[LLM] %s — retrying in %.1fs (attempt %d/%d)",
                                    last_error, delay, attempt + 1, 1 + self._max_retries)
                        time.sleep(delay)
                        continue
                    break

                # Non-retryable client error (400, 401, 403, etc.)
                if resp.status_code >= 400:
                    last_error = f"HTTP {resp.status_code}: {resp.text[:200]}"
                    print(f"  [LLM] {act_id} -> non-retryable error: {last_error}")
                    logger.warning("[LLM] Non-retryable error: %s", last_error)
                    break

                # Success — parse JSON
                try:
                    return resp.json()
                except (ValueError, json.JSONDecodeError) as e:
                    last_error = f"Invalid JSON in response: {e}"
                    print(f"  [LLM] {act_id} -> malformed API response: {e}")
                    logger.warning("[LLM] %s", last_error)
                    break

            except (requests.ConnectionError, requests.Timeout) as e:
                last_error = str(e)
                if attempt < self._max_retries:
                    delay = self._retry_delay * (2 ** attempt)
                    print(f"  [LLM] {act_id} -> {type(e).__name__} — retry {attempt + 1}/{self._max_retries} in {delay:.1f}s")
                    logger.info("[LLM] %s — retrying in %.1fs (attempt %d/%d)",
                                type(e).__name__, delay, attempt + 1, 1 + self._max_retries)
                    time.sleep(delay)
                    continue
                break

            except requests.RequestException as e:
                last_error = str(e)
                print(f"  [LLM] {act_id} -> unexpected request error: {e}")
                logger.warning("[LLM] Unexpected request error: %s", last_error)
                break

        # All attempts exhausted — silent fallback
        print(f"  [LLM] {act_id} -> all {1 + self._max_retries} attempt(s) failed: {last_error}")
        logger.warning("[LLM] All %d attempt(s) failed. Last error: %s",
                       1 + self._max_retries, last_error)
        return None

    def _parse_response(
        self, raw: str, text_source: str
    ) -> ClassificationResult:
        """Extract prediction, confidence, reason from the LLM JSON response."""
        # Strip markdown fences if the model wraps in ```json ... ```
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[-1]
        if cleaned.endswith("```"):
            cleaned = cleaned.rsplit("```", 1)[0]
        cleaned = cleaned.strip()

        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError:
            # Fallback: look for H or L anywhere in the response
            upper = raw.upper()
            if '"H"' in upper or "'H'" in upper:
                print(f"  [LLM] JSON parse failed — fell back to raw text match: prediction=H")
                return ClassificationResult(
                    prediction="H",
                    confidence=0.5,
                    reason=f"LLM (parsed from raw): {raw[:120]}",
                    classifier_name=self.name,
                    details={"raw": raw, "text_source": text_source, "parse_fallback": True},
                )
            elif '"L"' in upper or "'L'" in upper:
                print(f"  [LLM] JSON parse failed — fell back to raw text match: prediction=L")
                return ClassificationResult(
                    prediction="L",
                    confidence=0.5,
                    reason=f"LLM (parsed from raw): {raw[:120]}",
                    classifier_name=self.name,
                    details={"raw": raw, "text_source": text_source, "parse_fallback": True},
                )
            print(f"  [LLM] unparseable response (no H/L found): {raw[:80]!r}")
            return ClassificationResult(
                prediction=None,
                confidence=0.0,
                reason=f"LLM unparseable response: {raw[:120]}",
                classifier_name=self.name,
                details={"raw": raw, "text_source": text_source},
            )

        prediction = str(parsed.get("prediction", "")).strip().upper()
        if prediction not in ("H", "L"):
            prediction = None

        confidence = float(parsed.get("confidence", 0.5))
        confidence = max(0.0, min(confidence, 0.95))

        reason_text = parsed.get("reason", "")
        reason = f"LLM: {prediction} ({confidence:.2f}) — {reason_text}"

        return ClassificationResult(
            prediction=prediction,
            confidence=confidence,
            reason=reason,
            classifier_name=self.name,
            details={
                "raw": raw,
                "parsed": parsed,
                "text_source": text_source,
            },
        )
