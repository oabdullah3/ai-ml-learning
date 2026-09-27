#!/usr/bin/env python3
"""
Email Data Evaluation Pipeline
==================================
Analyzes labeled department response emails to understand structure, content patterns,
and classify difficulty — providing a data-driven foundation before building classifiers.

Usage:
    python email_data_eval.py <csv_or_excel_path>
    python email_data_eval.py   # auto-detects CSV/Excel in current directory

Output:
    - Console report
    - eval_report.txt (saved alongside the input file)
"""

import sys
import os
import re
from collections import Counter, defaultdict
from pathlib import Path
from io import StringIO

import pandas as pd
from bs4 import BeautifulSoup


# =============================================================================
# Configuration: keywords and boundary markers
# =============================================================================

# Reassignment signal keywords/patterns (case-insensitive)
REASSIGNMENT_KEYWORDS_EN = [
    r're-?assign',
    r'incorrectly\s+assigned',
    r'please\s+assign\s+(this\s+)?case\s+to',
    r'not\s+under\s+our',
    r'outside\s+(our\s+)?(maintenance\s+)?purview',
    r'should\s+be\s+referred\s+to',
    r'not\s+responsible',
    r'should\s+be\s+made\s+to\s+another\s+(party|department|bureau)',
    r'wrong\s+department',
    r'another\s+department',
    r'another\s+bureau',
    r'not\s+(within|under)\s+(the\s+)?(maintenance\s+)?purview',
    r'case\s+incorrectly',
    r'referred?\s+to\s+(the\s+)?(relevant|another|other)',
    r'this\s+case\s+(should|appears?\s+to)\s+be',
    r'complaint\s+against\s+the',
    r'returned\s+to\s+(the\s+)?',
]

REASSIGNMENT_KEYWORDS_ZH = [
    r'轉介',
    r'重新分配',
    r'非本署',
    r'非本部門',
    r'不屬本',
    r'請改派',
    r'不在本',
    r'並非本',
    r'本署管轄範圍以外',
    r'管轄範圍以外',
    r'請重新',
]

ALL_REASSIGNMENT_KEYWORDS = REASSIGNMENT_KEYWORDS_EN + REASSIGNMENT_KEYWORDS_ZH

# Boundary markers that separate department message from hotline template
BOUNDARY_MARKERS = {
    'Original Message': r'-{3,}\s*Original\s+Message\s*-{3,}',
    'From hotline': r'From:.*hotline@example\.gov',
    'Reply Slip V03': r'--\s*Reply\s+Slip\s+V0[0-9]\s*--',
    'CASE tag': r'<CASE>:',
    'CASE# ref': r'CASE#\d+-\d+',
    'CMIS#': r'CMIS#:',
    'ICC#': r'ICC#:',
    'HR tag': r'<hr[^>]*>',
    'hotline Duty Manager (fwd)': r'hotline\s+Duty\s+Manager',
    'Distribution List': r'Distribution\s+List\s*-',
    'Reply Slip end': r'--\s*End\s*--',
}

# Reply slip section codes
REPLY_SLIP_CODES = {
    # Section A: misassignment
    'ACK-A': r'<ACK-A>',
    'ACK-B': r'<ACK-B>',
    'ACK-C': r'<ACK-C>',
    'ACK-D': r'<ACK-D>',
    'ACK-E': r'<ACK-E>',
    # Section B: acknowledgement
    'ACK-F': r'<ACK-F>',
    'ACK-G': r'<ACK-G>',
    'ACK-H': r'<ACK-H>',
    # Section C: interim reply
    'INT-X': r'<INT-X>',
    'INT-A': r'<INT-A>',
    'INT-B': r'<INT-B>',
    'INT-C': r'<INT-C>',
    'INT-D': r'<INT-D>',
    'INT-E': r'<INT-E>',
    'INT-F': r'<INT-F>',
    'INT-G': r'<INT-G>',
    # Section D: substantive reply
    'SUB-X': r'<SUB-X>',
    'SUB-A': r'<SUB-A>',
    'SUB-B': r'<SUB-B>',
    'SUB-C': r'<SUB-C>',
    'SUB-D': r'<SUB-D>',
    'SUB-E': r'<SUB-E>',
    'SUB-F': r'<SUB-F>',
    'SUB-G': r'<SUB-G>',
    'SUB-H': r'<SUB-H>',
    # Section E: cancellation
    'CAN-A': r'<CAN-A>',
    # Extension
    'EXT-A': r'<EXT-A>',
}

MISASSIGNMENT_CODES = {'ACK-A', 'ACK-B', 'ACK-C', 'ACK-D', 'ACK-E'}


# =============================================================================
# Module 1: Input Loader
# =============================================================================

def load_data(filepath: str) -> pd.DataFrame:
    """Load email data from CSV or Excel. Returns cleaned DataFrame."""
    filepath = str(filepath)
    ext = os.path.splitext(filepath)[1].lower()

    if ext in ('.xlsx', '.xls'):
        df = pd.read_excel(filepath)
    else:
        # Try multiple encodings for CSV
        for enc in ['utf-8', 'utf-8-sig', 'cp1252', 'latin1']:
            try:
                df = pd.read_csv(filepath, encoding=enc)
                break
            except (UnicodeDecodeError, pd.errors.ParserError):
                continue
        else:
            raise ValueError(f"Could not parse CSV with known encodings: {filepath}")

    # Keep only the columns we need
    required_cols = ['EMAIL_BODY', 'LABELLED_PRIORITY']
    optional_cols = ['EMAIL_TITLE', 'ACT_ID']

    for col in required_cols:
        if col not in df.columns:
            raise ValueError(f"Missing required column: {col}")

    keep_cols = [c for c in required_cols + optional_cols if c in df.columns]
    df = df[keep_cols].copy()

    # Drop rows where both body and priority are missing
    df = df.dropna(subset=['EMAIL_BODY', 'LABELLED_PRIORITY'], how='all')

    # Drop rows where body is missing (can't analyze)
    df = df.dropna(subset=['EMAIL_BODY'])

    # Normalize priority labels
    df['LABELLED_PRIORITY'] = df['LABELLED_PRIORITY'].astype(str).str.strip().str.upper()
    df = df[df['LABELLED_PRIORITY'].isin(['H', 'L'])]

    # Ensure ACT_ID exists for identification
    if 'ACT_ID' not in df.columns:
        df['ACT_ID'] = [f'row_{i}' for i in range(len(df))]

    df = df.reset_index(drop=True)
    return df


def extract_text_from_html(html_body: str) -> str:
    """Extract visible text from HTML email body. Returns plain text."""
    if not isinstance(html_body, str):
        return ""
    try:
        soup = BeautifulSoup(html_body, 'lxml')
    except Exception:
        try:
            soup = BeautifulSoup(html_body, 'html.parser')
        except Exception:
            # Fall back to regex stripping
            text = re.sub(r'<[^>]+>', ' ', html_body)
            text = re.sub(r'&nbsp;', ' ', text)
            text = re.sub(r'&lt;', '<', text)
            text = re.sub(r'&gt;', '>', text)
            text = re.sub(r'&amp;', '&', text)
            return re.sub(r'\s+', ' ', text).strip()

    # Remove script/style elements
    for tag in soup(['script', 'style']):
        tag.decompose()

    text = soup.get_text(separator=' ')
    # Decode HTML entities that might remain
    text = re.sub(r'&nbsp;', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


# =============================================================================
# Module 2: Structural Analysis
# =============================================================================

def detect_format_type(body: str) -> str:
    """Classify email format type."""
    if not isinstance(body, str):
        return 'unknown'
    if body.strip().startswith('CMIS#:') or body.strip().startswith('ICC#:'):
        return 'cmis_structured'
    if re.search(r'<html[\s>]', body, re.IGNORECASE):
        return 'full_html'
    if re.search(r'<(span|div|br|p|meta|table|td|tr)[\s>/]', body, re.IGNORECASE):
        return 'partial_html'
    if '<' not in body or body.count('<') < 3:
        return 'plain_text'
    return 'partial_html'


def detect_boundary_markers(body: str, text: str) -> dict:
    """Check which boundary markers exist in the email."""
    results = {}
    # Search both raw HTML and extracted text
    combined = body + '\n' + text
    for name, pattern in BOUNDARY_MARKERS.items():
        results[name] = bool(re.search(pattern, combined, re.IGNORECASE))
    return results


def detect_reply_slip_codes(body: str, text: str) -> dict:
    """Detect which reply slip codes are present and which are filled in (marked with X)."""
    combined = body + '\n' + text
    results = {}
    for code_name, pattern in REPLY_SLIP_CODES.items():
        present = bool(re.search(pattern, combined, re.IGNORECASE))
        # Check if code is filled in: (X) near the code tag
        filled = False
        if present:
            # Look for (X) or ( X ) pattern near the code
            filled_pattern = rf'{pattern}\s*\(\s*[Xx]\s*\)'
            filled = bool(re.search(filled_pattern, combined, re.IGNORECASE))
        results[code_name] = {'present': present, 'filled': filled}
    return results


def count_email_chain_depth(body: str, text: str) -> int:
    """Estimate how many emails are in the chain."""
    combined = body + '\n' + text
    # Count forwarding indicators
    orig_msg = len(re.findall(r'-{3,}\s*Original\s+Message', combined, re.IGNORECASE))
    from_hotline = len(re.findall(r'From:.*hotline@example\.gov', combined, re.IGNORECASE))
    sent_blocks = len(re.findall(r'Sent:.*\d{4}', combined))
    return max(orig_msg, from_hotline, sent_blocks // 2, 1)


def analyze_structure(df: pd.DataFrame) -> dict:
    """Run structural analysis on all emails. Returns analysis dict."""
    results = {
        'format_types': Counter(),
        'boundary_markers': defaultdict(lambda: {'total': 0, 'H': 0, 'L': 0}),
        'reply_slip_present': {'total': 0, 'H': 0, 'L': 0},
        'codes_filled': defaultdict(lambda: {'total': 0, 'H': 0, 'L': 0}),
        'chain_depths': [],
        'per_email': [],
    }

    for _, row in df.iterrows():
        body = row['EMAIL_BODY']
        label = row['LABELLED_PRIORITY']
        act_id = row.get('ACT_ID', 'unknown')
        text = extract_text_from_html(body)

        fmt = detect_format_type(body)
        results['format_types'][fmt] += 1

        markers = detect_boundary_markers(body, text)
        for marker_name, found in markers.items():
            if found:
                results['boundary_markers'][marker_name]['total'] += 1
                results['boundary_markers'][marker_name][label] += 1

        codes = detect_reply_slip_codes(body, text)
        has_reply_slip = any(v['present'] for v in codes.values())
        if has_reply_slip:
            results['reply_slip_present']['total'] += 1
            results['reply_slip_present'][label] += 1

        for code_name, info in codes.items():
            if info['filled']:
                results['codes_filled'][code_name]['total'] += 1
                results['codes_filled'][code_name][label] += 1

        depth = count_email_chain_depth(body, text)
        results['chain_depths'].append(depth)

        results['per_email'].append({
            'act_id': act_id,
            'label': label,
            'format': fmt,
            'markers': markers,
            'codes_filled': {k: v['filled'] for k, v in codes.items()},
            'chain_depth': depth,
            'body_len': len(body),
            'text_len': len(text),
            'text': text,
            'body': body,
        })

    return results


# =============================================================================
# Module 3: Content Position Analysis
# =============================================================================

def find_first_boundary_position(text: str) -> tuple:
    """Find the position and type of the first boundary marker in text."""
    earliest_pos = len(text)
    earliest_marker = None

    # Priority ordered markers for splitting
    split_markers = [
        ('Original Message', r'-{3,}\s*Original\s+Message\s*-{3,}'),
        ('From hotline', r'From:?\s*.*hotline@example\.gov'),
        ('Reply Slip', r'--\s*Reply\s+Slip\s+V0[0-9]\s*--'),
        ('CASE# ref', r'CASE#\d+-\d+'),
        ('hotline Duty Manager', r'Thank\s+you\s+for\s+your\s+assistance\.\s*hotline\s+Duty\s+Manager'),
        ('hotline Refers', r'To:\s*-?\s*[A-Z].*We\s+would\s+like\s+to\s+refer'),
        ('Distribution List', r'Distribution\s+List\s*-'),
    ]

    for name, pattern in split_markers:
        match = re.search(pattern, text, re.IGNORECASE)
        if match and match.start() < earliest_pos:
            earliest_pos = match.start()
            earliest_marker = name

    if earliest_marker is None:
        return len(text), None
    return earliest_pos, earliest_marker


def analyze_content_positions(struct_results: dict) -> dict:
    """Analyze where reassignment signals appear relative to boundaries."""
    results = {
        'keyword_above_boundary': {'H': 0, 'L': 0},
        'keyword_below_boundary': {'H': 0, 'L': 0},
        'keyword_both': {'H': 0, 'L': 0},
        'no_keyword_found': {'H': 0, 'L': 0},
        'no_boundary_found': {'H': 0, 'L': 0},
        'boundary_used': Counter(),
        'dept_msg_lengths_H': [],
        'dept_msg_lengths_L': [],
        'all_h_signals_above': 0,
        'total_h_with_keywords': 0,
        'per_email': [],
    }

    for email_info in struct_results['per_email']:
        text = email_info['text']
        label = email_info['label']
        act_id = email_info['act_id']

        boundary_pos, boundary_type = find_first_boundary_position(text)

        if boundary_type is None:
            results['no_boundary_found'][label] += 1

        dept_msg = text[:boundary_pos].strip()
        template_msg = text[boundary_pos:].strip()

        if label == 'H':
            results['dept_msg_lengths_H'].append(len(dept_msg))
        else:
            results['dept_msg_lengths_L'].append(len(dept_msg))

        # Find keyword matches and their positions
        keyword_positions = []
        for kw in ALL_REASSIGNMENT_KEYWORDS:
            for match in re.finditer(kw, text, re.IGNORECASE):
                keyword_positions.append({
                    'keyword': kw,
                    'match': match.group(),
                    'pos': match.start(),
                    'above_boundary': match.start() < boundary_pos,
                })

        if not keyword_positions:
            results['no_keyword_found'][label] += 1
            position_category = 'none'
        else:
            above = any(kp['above_boundary'] for kp in keyword_positions)
            below = any(not kp['above_boundary'] for kp in keyword_positions)
            if above and below:
                results['keyword_both'][label] += 1
                position_category = 'both'
            elif above:
                results['keyword_above_boundary'][label] += 1
                position_category = 'above'
            else:
                results['keyword_below_boundary'][label] += 1
                position_category = 'below'

            if label == 'H':
                results['total_h_with_keywords'] += 1
                if above:
                    results['all_h_signals_above'] += 1

        if boundary_type:
            results['boundary_used'][boundary_type] += 1

        results['per_email'].append({
            'act_id': act_id,
            'label': label,
            'boundary_type': boundary_type,
            'boundary_pos': boundary_pos,
            'dept_msg_len': len(dept_msg),
            'dept_msg_preview': dept_msg[:200],
            'keyword_positions': keyword_positions,
            'position_category': position_category,
        })

    return results


# =============================================================================
# Module 4: Keyword & Language Analysis
# =============================================================================

def detect_language(text: str) -> str:
    """Detect dominant language: english, chinese, mixed."""
    chinese_chars = len(re.findall(r'[\u4e00-\u9fff\u3400-\u4dbf]', text))
    english_words = len(re.findall(r'[a-zA-Z]{2,}', text))

    if chinese_chars < 5 and english_words > 10:
        return 'english'
    if chinese_chars > 20 and english_words < 10:
        return 'chinese'
    if chinese_chars > 5 or english_words > 5:
        return 'mixed'
    return 'unknown'


def analyze_keywords(struct_results: dict) -> dict:
    """Analyze keyword effectiveness for classification."""
    results = {
        'keyword_stats': {},
        'language_dist': {'H': Counter(), 'L': Counter()},
        'best_single_keyword': None,
        'best_combo': None,
    }

    # Per-keyword analysis
    for kw in ALL_REASSIGNMENT_KEYWORDS:
        h_match = 0
        l_match = 0

        for email_info in struct_results['per_email']:
            text = email_info['text']
            label = email_info['label']
            if re.search(kw, text, re.IGNORECASE):
                if label == 'H':
                    h_match += 1
                else:
                    l_match += 1

        total_match = h_match + l_match
        total_h = sum(1 for e in struct_results['per_email'] if e['label'] == 'H')
        total_l = sum(1 for e in struct_results['per_email'] if e['label'] == 'L')

        precision = h_match / total_match if total_match > 0 else 0
        recall = h_match / total_h if total_h > 0 else 0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

        results['keyword_stats'][kw] = {
            'h_match': h_match,
            'l_match': l_match,
            'total_match': total_match,
            'precision': precision,
            'recall': recall,
            'f1': f1,
        }

    # Language detection
    for email_info in struct_results['per_email']:
        lang = detect_language(email_info['text'])
        results['language_dist'][email_info['label']][lang] += 1

    # Find best single keyword by F1
    if results['keyword_stats']:
        best_kw = max(results['keyword_stats'].items(), key=lambda x: x[1]['f1'])
        results['best_single_keyword'] = (best_kw[0], best_kw[1])

    # Find best "any match" combo: if ANY keyword matches → predict H
    total_h = sum(1 for e in struct_results['per_email'] if e['label'] == 'H')
    total_l = sum(1 for e in struct_results['per_email'] if e['label'] == 'L')
    combo_h = 0
    combo_l = 0
    for email_info in struct_results['per_email']:
        text = email_info['text']
        any_match = any(re.search(kw, text, re.IGNORECASE) for kw in ALL_REASSIGNMENT_KEYWORDS)
        if any_match:
            if email_info['label'] == 'H':
                combo_h += 1
            else:
                combo_l += 1

    combo_total = combo_h + combo_l
    combo_precision = combo_h / combo_total if combo_total > 0 else 0
    combo_recall = combo_h / total_h if total_h > 0 else 0
    combo_f1 = 2 * combo_precision * combo_recall / (combo_precision + combo_recall) if (combo_precision + combo_recall) > 0 else 0

    results['best_combo'] = {
        'h_match': combo_h,
        'l_match': combo_l,
        'precision': combo_precision,
        'recall': combo_recall,
        'f1': combo_f1,
    }

    return results


# =============================================================================
# Module 5: Edge Case Identification
# =============================================================================

def identify_edge_cases(struct_results: dict, position_results: dict) -> dict:
    """Identify emails that will be hard to classify."""
    results = {
        'h_without_keywords': [],
        'l_with_keywords': [],
        'no_boundary': [],
        'very_short_dept_msg': [],
        'reply_slip_filled_misassignment': [],
        'reply_slip_filled_other': [],
    }

    for pos_info, struct_info in zip(position_results['per_email'], struct_results['per_email']):
        act_id = pos_info['act_id']
        label = pos_info['label']
        snippet = pos_info['dept_msg_preview'][:150]

        # H without any reassignment keyword
        if label == 'H' and pos_info['position_category'] == 'none':
            results['h_without_keywords'].append({
                'act_id': act_id,
                'snippet': snippet,
                'dept_msg_len': pos_info['dept_msg_len'],
            })

        # L with reassignment keywords
        if label == 'L' and pos_info['position_category'] != 'none':
            matched_kws = [kp['match'] for kp in pos_info['keyword_positions']]
            results['l_with_keywords'].append({
                'act_id': act_id,
                'snippet': snippet,
                'keywords_found': matched_kws[:5],
            })

        # No boundary marker found
        if pos_info['boundary_type'] is None:
            results['no_boundary'].append({
                'act_id': act_id,
                'label': label,
                'snippet': snippet[:100],
                'body_len': struct_info['body_len'],
            })

        # Very short department message
        if pos_info['dept_msg_len'] < 50 and pos_info['boundary_type'] is not None:
            results['very_short_dept_msg'].append({
                'act_id': act_id,
                'label': label,
                'dept_msg': pos_info['dept_msg_preview'],
                'dept_msg_len': pos_info['dept_msg_len'],
            })

        # Reply slip codes filled in
        filled_codes = [c for c, v in struct_info['codes_filled'].items() if v]
        if filled_codes:
            misassignment = [c for c in filled_codes if c in MISASSIGNMENT_CODES]
            other = [c for c in filled_codes if c not in MISASSIGNMENT_CODES]
            if misassignment:
                results['reply_slip_filled_misassignment'].append({
                    'act_id': act_id,
                    'label': label,
                    'codes': misassignment,
                })
            if other:
                results['reply_slip_filled_other'].append({
                    'act_id': act_id,
                    'label': label,
                    'codes': other,
                })

    return results


# =============================================================================
# Report Generation
# =============================================================================

def generate_report(df: pd.DataFrame, struct_results: dict,
                    position_results: dict, keyword_results: dict,
                    edge_results: dict) -> str:
    """Generate the full evaluation report."""
    lines = []
    w = lines.append  # shortcut

    total = len(df)
    h_count = (df['LABELLED_PRIORITY'] == 'H').sum()
    l_count = (df['LABELLED_PRIORITY'] == 'L').sum()

    w("=" * 70)
    w("           EMAIL DATA EVALUATION REPORT")
    w("=" * 70)
    w("")

    # -------------------------------------------------------------------
    w("1. DATASET OVERVIEW")
    w("-" * 40)
    w(f"   Total emails:  {total}")
    w(f"   H (High):      {h_count} ({h_count/total*100:.1f}%)")
    w(f"   L (Low):       {l_count} ({l_count/total*100:.1f}%)")
    w(f"   H:L ratio:     1:{l_count/h_count:.1f}" if h_count > 0 else "   H:L ratio: N/A")
    w("")

    body_lens = df['EMAIL_BODY'].str.len()
    w(f"   Body length:   min={body_lens.min()}, max={body_lens.max()}, "
      f"mean={body_lens.mean():.0f}, median={body_lens.median():.0f}")

    title_nulls = df['EMAIL_TITLE'].isna().sum() if 'EMAIL_TITLE' in df.columns else total
    w(f"   EMAIL_TITLE:   {total - title_nulls} non-null, {title_nulls} null")
    w("")

    # -------------------------------------------------------------------
    w("2. STRUCTURAL PATTERNS")
    w("-" * 40)
    w("   a) Format Types:")
    for fmt, count in sorted(struct_results['format_types'].items(), key=lambda x: -x[1]):
        h_fmt = sum(1 for e in struct_results['per_email'] if e['format'] == fmt and e['label'] == 'H')
        l_fmt = sum(1 for e in struct_results['per_email'] if e['format'] == fmt and e['label'] == 'L')
        w(f"      {fmt:20s}: {count:3d} ({count/total*100:5.1f}%)  [H:{h_fmt:2d} L:{l_fmt:2d}]")
    w("")

    w("   b) Boundary Markers Found:")
    w(f"      {'Marker':<25s} {'Total':>5s} {'H':>5s} {'L':>5s} {'H%':>6s}")
    w(f"      {'-'*25} {'-'*5} {'-'*5} {'-'*5} {'-'*6}")
    for name in BOUNDARY_MARKERS:
        info = struct_results['boundary_markers'].get(name, {'total': 0, 'H': 0, 'L': 0})
        if isinstance(info, dict):
            t, h, l = info['total'], info['H'], info['L']
        else:
            t, h, l = 0, 0, 0
        if t > 0:
            w(f"      {name:<25s} {t:5d} {h:5d} {l:5d} {h/t*100:5.1f}%")
    w("")

    rsp = struct_results['reply_slip_present']
    w(f"   c) Reply Slip Present:  {rsp['total']} ({rsp['total']/total*100:.1f}%)"
      f"  [H:{rsp['H']} L:{rsp['L']}]")

    # Filled-in codes
    w("   d) Reply Slip Codes FILLED IN (marked with X):")
    any_filled = False
    for code_name in sorted(struct_results['codes_filled'].keys()):
        info = struct_results['codes_filled'][code_name]
        if info['total'] > 0:
            any_filled = True
            category = "MISASSIGNMENT" if code_name in MISASSIGNMENT_CODES else "other"
            w(f"      {code_name:<8s}: {info['total']:3d} emails  "
              f"[H:{info['H']:2d} L:{info['L']:2d}]  ({category})")
    if not any_filled:
        w("      (none detected)")
    w("")

    depths = struct_results['chain_depths']
    w(f"   e) Email Chain Depth:  avg={sum(depths)/len(depths):.1f}, "
      f"min={min(depths)}, max={max(depths)}")
    w("")

    # -------------------------------------------------------------------
    w("3. CONTENT POSITION ANALYSIS")
    w("-" * 40)

    pr = position_results
    w("   Where do reassignment keywords appear?")
    w(f"      {'Category':<25s} {'H':>4s} {'L':>4s}")
    w(f"      {'-'*25} {'-'*4} {'-'*4}")
    w(f"      {'Above boundary only':<25s} {pr['keyword_above_boundary']['H']:4d} {pr['keyword_above_boundary']['L']:4d}")
    w(f"      {'Below boundary only':<25s} {pr['keyword_below_boundary']['H']:4d} {pr['keyword_below_boundary']['L']:4d}")
    w(f"      {'Both above & below':<25s} {pr['keyword_both']['H']:4d} {pr['keyword_both']['L']:4d}")
    w(f"      {'No keywords found':<25s} {pr['no_keyword_found']['H']:4d} {pr['no_keyword_found']['L']:4d}")
    w(f"      {'No boundary found':<25s} {pr['no_boundary_found']['H']:4d} {pr['no_boundary_found']['L']:4d}")
    w("")

    if pr['total_h_with_keywords'] > 0:
        pct = pr['all_h_signals_above'] / pr['total_h_with_keywords'] * 100
        w(f"   H emails with keywords above boundary: {pr['all_h_signals_above']}/{pr['total_h_with_keywords']} ({pct:.1f}%)")
    w("")

    w("   Best boundary marker for splitting (most frequently found):")
    for marker, count in pr['boundary_used'].most_common(5):
        w(f"      {marker:<25s}: {count:3d} emails")
    w("")

    # Department message length stats
    h_lens = pr['dept_msg_lengths_H']
    l_lens = pr['dept_msg_lengths_L']
    if h_lens:
        w(f"   Dept message length (H): min={min(h_lens)}, max={max(h_lens)}, "
          f"mean={sum(h_lens)/len(h_lens):.0f}, median={sorted(h_lens)[len(h_lens)//2]}")
    if l_lens:
        w(f"   Dept message length (L): min={min(l_lens)}, max={max(l_lens)}, "
          f"mean={sum(l_lens)/len(l_lens):.0f}, median={sorted(l_lens)[len(l_lens)//2]}")
    w("")

    # -------------------------------------------------------------------
    w("4. KEYWORD EFFECTIVENESS")
    w("-" * 40)

    # Sort keywords by F1 score
    sorted_kws = sorted(keyword_results['keyword_stats'].items(),
                        key=lambda x: x[1]['f1'], reverse=True)

    w(f"   {'Keyword':<45s} {'Matched':>7s} {'H':>4s} {'L':>4s} {'Prec':>5s} {'Recall':>6s} {'F1':>5s}")
    w(f"   {'-'*45} {'-'*7} {'-'*4} {'-'*4} {'-'*5} {'-'*6} {'-'*5}")
    for kw, stats in sorted_kws:
        if stats['total_match'] > 0:
            w(f"   {kw:<45s} {stats['total_match']:7d} {stats['h_match']:4d} "
              f"{stats['l_match']:4d} {stats['precision']:5.2f} {stats['recall']:6.2f} {stats['f1']:5.2f}")
    w("")

    if keyword_results['best_single_keyword']:
        kw, stats = keyword_results['best_single_keyword']
        w(f"   Best single keyword: \"{kw}\"")
        w(f"     Precision={stats['precision']:.2f}, Recall={stats['recall']:.2f}, F1={stats['f1']:.2f}")
    w("")

    combo = keyword_results['best_combo']
    w(f"   Best keyword combo (ANY match → H):")
    w(f"     Matched: {combo['h_match']}H + {combo['l_match']}L = {combo['h_match']+combo['l_match']} total")
    w(f"     Precision={combo['precision']:.2f}, Recall={combo['recall']:.2f}, F1={combo['f1']:.2f}")
    w("")

    w("   Language Distribution:")
    for label in ['H', 'L']:
        lang_counts = keyword_results['language_dist'][label]
        parts = [f"{lang}:{cnt}" for lang, cnt in sorted(lang_counts.items(), key=lambda x: -x[1])]
        w(f"     {label}: {', '.join(parts)}")
    w("")

    # -------------------------------------------------------------------
    w("5. EDGE CASES & DIFFICULTY ANALYSIS")
    w("-" * 40)

    er = edge_results

    w(f"   a) H emails WITHOUT any reassignment keyword: {len(er['h_without_keywords'])}")
    for item in er['h_without_keywords'][:5]:
        w(f"      [{item['act_id']}] (dept_msg_len={item['dept_msg_len']})")
        w(f"        \"{item['snippet'][:120]}...\"")
    w("")

    w(f"   b) L emails WITH reassignment keywords (false positive risk): {len(er['l_with_keywords'])}")
    for item in er['l_with_keywords'][:5]:
        kws = ', '.join(item['keywords_found'][:3])
        w(f"      [{item['act_id']}] keywords: [{kws}]")
        w(f"        \"{item['snippet'][:120]}...\"")
    w("")

    w(f"   c) Emails with NO boundary marker: {len(er['no_boundary'])}")
    for item in er['no_boundary'][:5]:
        w(f"      [{item['act_id']}] label={item['label']}, body_len={item['body_len']}")
        w(f"        \"{item['snippet'][:100]}...\"")
    w("")

    w(f"   d) Very short dept message (<50 chars): {len(er['very_short_dept_msg'])}")
    for item in er['very_short_dept_msg'][:5]:
        w(f"      [{item['act_id']}] label={item['label']}, len={item['dept_msg_len']}")
        w(f"        \"{item['dept_msg'][:80]}\"")
    w("")

    w(f"   e) Reply slip MISASSIGNMENT codes filled: {len(er['reply_slip_filled_misassignment'])}")
    for item in er['reply_slip_filled_misassignment'][:5]:
        w(f"      [{item['act_id']}] label={item['label']}, codes={item['codes']}")
    w("")

    w(f"   f) Reply slip OTHER codes filled: {len(er['reply_slip_filled_other'])}")
    for item in er['reply_slip_filled_other'][:5]:
        w(f"      [{item['act_id']}] label={item['label']}, codes={item['codes']}")
    if len(er['reply_slip_filled_other']) > 5:
        w(f"      ... and {len(er['reply_slip_filled_other']) - 5} more")
    w("")

    # -------------------------------------------------------------------
    w("6. RECOMMENDATIONS")
    w("-" * 40)

    recommendations = []

    # Check if reply slip codes alone could solve it
    total_filled = len(er['reply_slip_filled_misassignment']) + len(er['reply_slip_filled_other'])
    if total_filled > total * 0.3:
        recommendations.append(
            f"STRONG: {total_filled}/{total} ({total_filled/total*100:.0f}%) emails have reply "
            f"slip codes filled in. A rule-based system checking filled codes could handle "
            f"a significant portion of emails deterministically."
        )

    # Check keyword effectiveness
    if combo['f1'] > 0.8:
        recommendations.append(
            f"STRONG: Keyword-based detection achieves F1={combo['f1']:.2f}. "
            f"A simple regex/keyword classifier may be sufficient."
        )
    elif combo['f1'] > 0.6:
        recommendations.append(
            f"MODERATE: Keyword-based detection achieves F1={combo['f1']:.2f}. "
            f"Useful as a feature/stage-1, but needs LLM/ML for edge cases."
        )

    if len(er['h_without_keywords']) > 0:
        recommendations.append(
            f"INVESTIGATE: {len(er['h_without_keywords'])} H emails have NO reassignment keywords. "
            f"These need manual review to understand what signals they contain."
        )

    if len(er['l_with_keywords']) > 0:
        recommendations.append(
            f"INVESTIGATE: {len(er['l_with_keywords'])} L emails contain reassignment-like keywords "
            f"(false positive risk). Review these to refine keyword list or add exclusion rules."
        )

    if pr['no_boundary_found']['H'] + pr['no_boundary_found']['L'] > 0:
        no_bound = pr['no_boundary_found']['H'] + pr['no_boundary_found']['L']
        recommendations.append(
            f"NOTE: {no_bound} emails have no detectable boundary marker. "
            f"Extraction-based approaches need a fallback for these."
        )

    # Check if position analysis supports extraction
    if pr['total_h_with_keywords'] > 0:
        pct_above = pr['all_h_signals_above'] / pr['total_h_with_keywords'] * 100
        if pct_above > 90:
            recommendations.append(
                f"STRONG: {pct_above:.0f}% of H emails have signals above the boundary. "
                f"Extraction of department message before classification is well-supported."
            )
        elif pct_above > 70:
            recommendations.append(
                f"MODERATE: {pct_above:.0f}% of H emails have signals above the boundary. "
                f"Extraction helps but some signals are in the template area too."
            )

    for i, rec in enumerate(recommendations, 1):
        w(f"   {i}. {rec}")
        w("")

    w("=" * 70)
    w("                    END OF REPORT")
    w("=" * 70)

    return '\n'.join(lines)


# =============================================================================
# Main
# =============================================================================

def find_data_file(search_dir: str = '.') -> str:
    """Auto-detect CSV or Excel file in directory."""
    search_dir = Path(search_dir)
    candidates = []
    for ext in ['*.csv', '*.xlsx', '*.xls']:
        candidates.extend(search_dir.glob(ext))
    # Filter out venv and hidden dirs
    candidates = [c for c in candidates if '.venv' not in str(c) and not c.name.startswith('.')]
    if not candidates:
        raise FileNotFoundError(f"No CSV/Excel files found in {search_dir}")
    if len(candidates) == 1:
        return str(candidates[0])
    # Prefer files with 'email' or 'test' in name
    for c in candidates:
        if 'email' in c.name.lower() or 'test' in c.name.lower():
            return str(c)
    return str(candidates[0])


def main():
    # Determine input file
    if len(sys.argv) > 1:
        filepath = sys.argv[1]
    else:
        try:
            filepath = find_data_file(os.path.dirname(os.path.abspath(__file__)))
        except FileNotFoundError as e:
            print(f"Error: {e}")
            print("Usage: python email_data_eval.py <csv_or_excel_path>")
            sys.exit(1)

    print(f"Loading data from: {filepath}")

    # Module 1: Load
    df = load_data(filepath)
    print(f"Loaded {len(df)} emails ({(df['LABELLED_PRIORITY']=='H').sum()} H, "
          f"{(df['LABELLED_PRIORITY']=='L').sum()} L)")

    # Module 2: Structural analysis
    print("Running structural analysis...")
    struct_results = analyze_structure(df)

    # Module 3: Content position analysis
    print("Running content position analysis...")
    position_results = analyze_content_positions(struct_results)

    # Module 4: Keyword analysis
    print("Running keyword analysis...")
    keyword_results = analyze_keywords(struct_results)

    # Module 5: Edge case identification
    print("Identifying edge cases...")
    edge_results = identify_edge_cases(struct_results, position_results)

    # Generate report
    print("Generating report...")
    report = generate_report(df, struct_results, position_results,
                             keyword_results, edge_results)

    # Print to console
    print()
    print(report)

    # Save to file
    output_dir = os.path.dirname(os.path.abspath(filepath))
    output_path = os.path.join(output_dir, 'eval_report.txt')
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(report)
    print(f"\nReport saved to: {output_path}")


if __name__ == '__main__':
    main()
