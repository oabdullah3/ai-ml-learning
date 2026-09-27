"""
HTML Cleaner Preprocessor.

Strips HTML tags, decodes entities, and produces clean plain text
from the raw email body. Populates ctx.clean_text and ctx.format_type.
"""

import re
from email_classifier.core import Preprocessor, EmailContext

try:
    from bs4 import BeautifulSoup
    HAS_BS4 = True
except ImportError:
    HAS_BS4 = False


class HtmlCleaner(Preprocessor):
    """Strip HTML from email body and produce clean text."""

    @property
    def name(self) -> str:
        return "html_cleaner"

    def process(self, ctx: EmailContext) -> None:
        body = ctx.raw_body
        if not isinstance(body, str) or not body.strip():
            ctx.clean_text = ""
            ctx.format_type = "empty"
            return

        # Detect format type
        ctx.format_type = self._detect_format(body)

        # Extract text
        if ctx.format_type in ('full_html', 'partial_html'):
            ctx.clean_text = self._strip_html(body)
        else:
            # Plain text or CMIS — just decode entities and normalize whitespace
            ctx.clean_text = self._normalize_text(body)

    def _detect_format(self, body: str) -> str:
        stripped = body.strip()
        if stripped.startswith('CMIS#:') or stripped.startswith('ICC#:'):
            return 'cmis_structured'
        if re.search(r'<html[\s>]', body, re.IGNORECASE):
            return 'full_html'
        if re.search(r'<(span|div|br|p|meta|table|td|tr)[\s>/]', body, re.IGNORECASE):
            return 'partial_html'
        if '<' not in body or body.count('<') < 3:
            return 'plain_text'
        return 'partial_html'

    def _strip_html(self, html: str) -> str:
        """Use BeautifulSoup if available, else regex fallback."""
        if HAS_BS4:
            try:
                soup = BeautifulSoup(html, 'lxml')
            except Exception:
                try:
                    soup = BeautifulSoup(html, 'html.parser')
                except Exception:
                    return self._regex_strip(html)

            # Remove non-visible elements
            for tag in soup(['script', 'style', 'head']):
                tag.decompose()

            # Get text with space separators
            text = soup.get_text(separator=' ')
            return self._normalize_text(text)
        else:
            return self._regex_strip(html)

    def _regex_strip(self, html: str) -> str:
        """Fallback HTML stripping via regex."""
        text = re.sub(r'<style[^>]*>.*?</style>', ' ', html, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r'<script[^>]*>.*?</script>', ' ', text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r'<!--.*?-->', ' ', text, flags=re.DOTALL)
        text = re.sub(r'<br\s*/?\s*>', '\n', text, flags=re.IGNORECASE)
        text = re.sub(r'<[^>]+>', ' ', text)
        return self._normalize_text(text)

    def _normalize_text(self, text: str) -> str:
        """Decode HTML entities & normalize whitespace."""
        text = re.sub(r'&nbsp;', ' ', text)
        text = re.sub(r'&lt;', '<', text)
        text = re.sub(r'&gt;', '>', text)
        text = re.sub(r'&amp;', '&', text)
        text = re.sub(r'&quot;', '"', text)
        text = re.sub(r'&#\d+;', ' ', text)
        text = re.sub(r'&\w+;', ' ', text)
        # Collapse whitespace but preserve newlines somewhat
        text = re.sub(r'[ \t]+', ' ', text)
        text = re.sub(r'\n\s*\n', '\n\n', text)
        return text.strip()
