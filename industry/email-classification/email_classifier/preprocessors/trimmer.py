"""
Email Trimmer Preprocessor.

Separates the department's own response message from the forwarded
hotline template/reply slip below it.

Populates:
    ctx.dept_message      -- the department's own text
    ctx.template_text     -- the hotline template portion
    ctx.boundary_marker   -- which marker was used to split
    ctx.boundary_position -- char position of the boundary
"""

import re
from email_classifier.core import Preprocessor, EmailContext
from email_classifier import config


class EmailTrimmer(Preprocessor):
    """Extract the department's own message from above the hotline template."""

    @property
    def name(self) -> str:
        return "email_trimmer"

    def process(self, ctx: EmailContext) -> None:
        text = ctx.clean_text
        if not text:
            ctx.dept_message = ""
            ctx.template_text = ""
            return

        # Try primary boundary markers in priority order
        pos, marker_name = self._find_boundary(text, config.BOUNDARY_MARKERS)

        # If no primary marker found, try fallback markers
        if pos is None:
            pos, marker_name = self._find_boundary(text, config.FALLBACK_BOUNDARY_MARKERS)

        # If still no boundary found, use heuristic
        if pos is None:
            pos, marker_name = self._heuristic_split(text)

        if pos is not None and pos > 0:
            ctx.dept_message = text[:pos].strip()
            ctx.template_text = text[pos:].strip()
            ctx.boundary_marker = marker_name
            ctx.boundary_position = pos
        elif pos == 0:
            # Boundary at the very start -- entire email is template
            # This happens with reply-slip-only emails (no dept message)
            ctx.dept_message = ""
            ctx.template_text = text.strip()
            ctx.boundary_marker = marker_name
            ctx.boundary_position = 0
        else:
            # No boundary at all -- treat entire text as dept message
            ctx.dept_message = text.strip()
            ctx.template_text = ""
            ctx.boundary_marker = None
            ctx.boundary_position = None

        # Strip reply slip template boilerplate from dept_message if present.
        # The template contains reassignment keywords ("Please assign this case
        # to", "INCORRECTLY ASSIGNED", "re-assign") as blank form options, NOT
        # as the department's actual words.  Leaving them in causes false positives.
        reply_slip_stripped = False
        if ctx.dept_message:
            cleaned, reply_slip_stripped = self._strip_reply_slip_template(ctx.dept_message)
            if reply_slip_stripped:
                ctx.dept_message = cleaned

        # Store the raw trimming metadata for logging
        ctx.metadata['trimmer'] = {
            'boundary_marker': marker_name,
            'boundary_position': pos,
            'dept_msg_len': len(ctx.dept_message),
            'template_len': len(ctx.template_text),
            'reply_slip_stripped': reply_slip_stripped,
        }

    def _find_boundary(self, text, markers):
        """
        Try each marker pattern. Return (position, marker_name) of the
        first match that ISN'T inside quotes or obviously part of the
        department's own message.
        """
        candidates = []
        for name, pattern in markers:
            match = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
            if match:
                candidates.append((match.start(), name, match))

        if not candidates:
            return None, None

        # Sort by position -- prefer the earliest boundary
        candidates.sort(key=lambda x: x[0])

        # Return the earliest reasonable boundary
        for pos, name, match in candidates:
            # Skip if the boundary is within the first 10 chars (likely false positive)
            # unless it's a "To hotline" or "CMIS" type (reply-slip-only emails)
            if pos < 10 and name not in ("To hotline block", "CMIS header", "CASE tag"):
                continue
            return pos, name

        # If all were skipped, return the first one anyway
        return candidates[0][0], candidates[0][1]

    def _heuristic_split(self, text):
        """
        Fallback heuristic when no standard boundary is found.
        Looks for structural cues like "To : hotline" or reply slip patterns.
        """
        # Look for "To : hotline" which starts many reply slips
        match = re.search(r'To\s*:\s*hotline(?:\s|$)', text)
        if match:
            return match.start(), "heuristic: To hotline"

        # Look for CASE/DEPT/NR pattern which appears in reply slips
        match = re.search(r'<(?:CASE|DEPT|NR)>\s*:', text)
        if match:
            return match.start(), "heuristic: reply slip tags"

        # Look for the standard reply slip section headers
        match = re.search(
            r'(?:A1\.\s*CASE INCORRECTLY|B\.?\s*ACKNOWLEDGEMENT|This referral should)',
            text, re.IGNORECASE
        )
        if match:
            return match.start(), "heuristic: section header"

        # No boundary found at all
        return None, None

    @staticmethod
    def _strip_reply_slip_template(text: str) -> tuple:
        """
        Remove the reply slip template block from text.

        The reply slip is a standard form with sections like:
          -- Reply Slip V03 --
          A1. CASE INCORRECTLY ASSIGNED
          <ACK-A>() ... <ACK-A>
          <ACK-D>() Please assign this case to ...
          B. ACKNOWLEDGEMENT
          ... etc

        These contain reassignment keywords as *blank form options*, not as
        the department's actual words.  We detect the start of the template
        and remove everything from there to the end of the form (marked by
        '===' or end of text).

        Returns (cleaned_text, was_stripped).
        """
        # Detect start of reply slip template
        start_match = re.search(
            r'--\s*Reply\s+Slip\s+V0\d\s*--|'
            r'This\s+referral\s+should\s+be\s+made\s+to\s+another\s+party|'
            r'A1\.?\s*CASE\s+INCORRECTLY\s+ASSIGNED',
            text, re.IGNORECASE
        )
        if not start_match:
            return text, False

        start_pos = start_match.start()
        remainder = text[start_pos:]

        # Find the end of the reply slip block.
        # The template ends with "===" separator or runs to end of text.
        # We look for the LAST "===" that separates sections within the slip.
        # After the template, there may be actual department free-text (e.g.
        # remarks or a separate message that follows the form).

        # Strategy: find the end of the last coded section (<EXT-A>, <CAN-A>,
        # <ACK-Remarks>, <REF-Remarks>, etc.) or the final "===".
        # Everything before that is template; everything after may be real text.

        # Find all "===" separators in the remainder
        sep_positions = [m.start() for m in re.finditer(r'={3,}', remainder)]

        if sep_positions:
            # The template typically has one or more === separators.
            # Take text after the LAST separator as potential real dept text.
            last_sep = sep_positions[-1]
            # Skip past the separator itself
            after_sep = remainder[last_sep:]
            end_of_sep = re.match(r'={3,}\s*', after_sep)
            if end_of_sep:
                after_template = after_sep[end_of_sep.end():].strip()
            else:
                after_template = after_sep[3:].strip()
        else:
            after_template = ""

        # Reconstruct: text before template + any real text after template
        before_template = text[:start_pos].strip()

        parts = [p for p in [before_template, after_template] if p]
        cleaned = '\n\n'.join(parts).strip()

        # Only count as stripped if we actually removed something
        if len(cleaned) < len(text.strip()):
            return cleaned, True

        return text, False
