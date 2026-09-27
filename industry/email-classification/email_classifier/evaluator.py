"""
Evaluator -- runs the pipeline against labeled data and produces detailed
metrics and per-email logs that can be used to diagnose and improve the system.

Outputs:
    1. Summary metrics (F1, precision, recall, accuracy, confusion matrix)
    2. Per-email detailed log (CSV-like) with all intermediate data
    3. Error analysis: breakdown of wrong predictions with reasons
    4. Classifier contribution analysis: how often each classifier decided
    5. Trimmer effectiveness: boundary detection stats
"""

from __future__ import annotations

import os
import json
import time
from datetime import datetime
from typing import List, Optional

import pandas as pd
from sklearn.metrics import (
    precision_score,
    recall_score,
    f1_score,
    accuracy_score,
)

from email_classifier.pipeline import Pipeline, PipelineResult


def generate_pipeline_config_code(pipeline: Pipeline) -> str:
    """
    Generate an 8-character code representing the pipeline configuration.
    
    Format: {2-char preprocessor code}{6-char classifier code}_{timestamp}
    
    Preprocessor codes (first 2 chars):
      - C = HTML Cleaner, T = Email Trimmer
      - CT = both, C0 = only cleaner, 0T = only trimmer, 00 = none
    
    Classifier codes (last 6 chars, in order):
      K = Keyword Scorer
      R = Reply Slip
      E = Embedding KNN
      S = SetFit
      Z = Zero Shot NLI
      L = LLM
      0 = not used
    
    Example: CT_KRESZL_{timestamp}  (all components used)
             C0_K0ES00_{timestamp}  (cleaner only, keyword + embedding + setfit)
    """
    # --- Generate preprocessor code (first 2 chars) ---
    has_cleaner = any(p.name == 'html_cleaner' for p in pipeline.preprocessors)
    has_trimmer = any(p.name == 'email_trimmer' for p in pipeline.preprocessors)
    
    cleaner_char = 'C' if has_cleaner else '0'
    trimmer_char = 'T' if has_trimmer else '0'
    preprocessor_code = cleaner_char + trimmer_char
    
    # --- Generate classifier code (6 chars) ---
    # Map classifier names to their codes
    classifier_name_to_code = {
        'keyword_scorer': 'K',
        'reply_slip_codes': 'R',
        'embedding_knn': 'E',
        'setfit': 'S',
        'zero_shot_nli': 'Z',
        'llm': 'L',
    }
    
    # Build list of 6 codes in the predefined order: K, R, E, S, Z, L
    classifier_codes = ['0'] * 6
    classifier_order = [
        'keyword_scorer',
        'reply_slip_codes',
        'embedding_knn',
        'setfit',
        'zero_shot_nli',
        'llm',
    ]
    
    # Get the names of all classifiers in the pipeline
    pipeline_classifier_names = {clf.name for clf, _ in pipeline.classifiers}
    
    # Fill in the codes for classifiers that are present
    for i, clf_name in enumerate(classifier_order):
        if clf_name in pipeline_classifier_names:
            classifier_codes[i] = classifier_name_to_code[clf_name]
    
    classifier_code = ''.join(classifier_codes)
    
    # --- Combine into 8-character code ---
    return preprocessor_code + classifier_code


class Evaluator:
    """
    Evaluate a Pipeline against labeled email data.

    Usage:
        evaluator = Evaluator(pipeline)
        evaluator.run(df)  # DataFrame with EMAIL_BODY, LABELLED_PRIORITY, ACT_ID
        evaluator.print_report()
        evaluator.save_logs("logs/")
    """

    def __init__(self, pipeline: Pipeline):
        self.pipeline = pipeline
        self.results: List[PipelineResult] = []
        self.run_timestamp: str = ""

    def run(self, df: pd.DataFrame) -> None:
        """Run the pipeline on every email in the DataFrame."""
        self.results = []
        self.segments = []  # parallel list: segment name per result
        self.elapsed_times = []  # per-email classification time in seconds
        self.run_timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self._run_start = time.perf_counter()

        for _, row in df.iterrows():
            raw_body = row.get('EMAIL_BODY', '')
            email_title = row.get('EMAIL_TITLE', None)
            act_id = str(row.get('ACT_ID', ''))
            true_label = str(row.get('LABELLED_PRIORITY', '')).strip().upper()

            if true_label not in ('H', 'L'):
                true_label = None

            if not isinstance(email_title, str):
                email_title = None

            # Determine segment: SEEN / INSCOPE / OUTSCOPE
            is_seen = str(row.get('IS_SEEN', '')).strip().upper()
            in_scope = str(row.get('IN_SCOPE', '')).strip().upper()
            if is_seen == 'TRUE':
                segment = 'SEEN'
            elif in_scope == 'TRUE':
                segment = 'INSCOPE'
            else:
                segment = 'OUTSCOPE'

            t0 = time.perf_counter()
            result = self.pipeline.classify_email(
                raw_body=raw_body,
                email_title=email_title,
                act_id=act_id,
                true_label=true_label,
            )
            elapsed = time.perf_counter() - t0

            # Keep original segmentation flags for per-email logs.
            # Store as text so output is explicit and consistent in CSV/XLSX.
            result.context.metadata['is_seen'] = is_seen
            result.context.metadata['in_scope'] = in_scope
            result.context.metadata['segment'] = segment
            self.results.append(result)
            self.segments.append(segment)
            self.elapsed_times.append(elapsed)

    # =========================================================================
    # Metrics (powered by sklearn)
    # =========================================================================

    @staticmethod
    def _compute_metrics(y_true: list, y_pred: list) -> dict:
        """Compute H-class and L-class metrics for a given set of predictions using sklearn."""
        total = len(y_true)
        if total == 0:
            return {
                'total': 0,
                'h_f1': 0.0, 'h_precision': 0.0, 'h_recall': 0.0, 'h_accuracy': 0.0,
                'l_f1': 0.0, 'l_precision': 0.0, 'l_recall': 0.0, 'l_accuracy': 0.0,
                'fn_count': 0, 'fp_count': 0, 'fn_pct': 0.0, 'fp_pct': 0.0,
            }

        # Count FN and FP (relative to H class)
        fn = sum(1 for t, p in zip(y_true, y_pred) if t == 'H' and p == 'L')
        fp = sum(1 for t, p in zip(y_true, y_pred) if t == 'L' and p == 'H')

        acc = accuracy_score(y_true, y_pred)
        return {
            'total': total,
            'h_f1': f1_score(y_true, y_pred, pos_label='H', zero_division=0),
            'h_precision': precision_score(y_true, y_pred, pos_label='H', zero_division=0),
            'h_recall': recall_score(y_true, y_pred, pos_label='H', zero_division=0),
            'h_accuracy': acc,
            'l_f1': f1_score(y_true, y_pred, pos_label='L', zero_division=0),
            'l_precision': precision_score(y_true, y_pred, pos_label='L', zero_division=0),
            'l_recall': recall_score(y_true, y_pred, pos_label='L', zero_division=0),
            'l_accuracy': acc,
            'fn_count': fn, 'fp_count': fp,
            'fn_pct': fn / total * 100, 'fp_pct': fp / total * 100,
        }

    def _get_predictions(self, segment: str = None) -> tuple:
        """Extract aligned y_true, y_pred lists, optionally filtered by segment."""
        y_true = []
        y_pred = []
        for i, r in enumerate(self.results):
            if r.true_label is None:
                continue
            if segment is not None and self.segments[i] != segment:
                continue
            # Exclude rows where the LLM errored — prediction would be
            # DEFAULT_PREDICTION (meaningless), not a real classifier output.
            if r.context.metadata.get('llm_error'):
                continue
            y_true.append(r.true_label)
            y_pred.append(r.final_prediction)
        return y_true, y_pred

    def metrics(self) -> dict:
        """Calculate all evaluation metrics using sklearn, segmented by SEEN/INSCOPE/OUTSCOPE."""
        y_true_all, y_pred_all = self._get_predictions()
        overall = self._compute_metrics(y_true_all, y_pred_all)

        y_true_seen, y_pred_seen = self._get_predictions('SEEN')
        seen = self._compute_metrics(y_true_seen, y_pred_seen)

        y_true_inscope, y_pred_inscope = self._get_predictions('INSCOPE')
        inscope = self._compute_metrics(y_true_inscope, y_pred_inscope)

        y_true_outscope, y_pred_outscope = self._get_predictions('OUTSCOPE')
        outscope = self._compute_metrics(y_true_outscope, y_pred_outscope)

        return {
            'overall': overall,
            'seen': seen,
            'inscope': inscope,
            'outscope': outscope,
        }

    # =========================================================================
    # Error analysis
    # =========================================================================

    def _error_analysis(self) -> dict:
        """Detailed breakdown of incorrect predictions."""
        false_positives = []  # Predicted H, actually L
        false_negatives = []  # Predicted L, actually H

        for r in self.results:
            if r.is_correct is None or r.is_correct:
                continue
            entry = {
                'act_id': r.act_id,
                'true_label': r.true_label,
                'predicted': r.final_prediction,
                'confidence': r.final_confidence,
                'deciding_classifier': r.deciding_classifier,
                'reason': r.final_reason,
                'format_type': r.context.format_type,
                'boundary_marker': r.context.boundary_marker,
                'dept_msg_len': len(r.context.dept_message),
                'dept_msg_preview': r.context.dept_message[:200],
                'classifier_results': [
                    {
                        'name': cr.classifier_name,
                        'prediction': cr.prediction,
                        'confidence': cr.confidence,
                        'reason': cr.reason,
                    }
                    for cr in r.classifier_results
                ],
            }
            if r.true_label == 'L' and r.final_prediction == 'H':
                false_positives.append(entry)
            elif r.true_label == 'H' and r.final_prediction == 'L':
                false_negatives.append(entry)

        return {
            'false_positives': false_positives,
            'false_negatives': false_negatives,
        }

    # =========================================================================
    # Classifier contribution analysis
    # =========================================================================

    def _classifier_contributions(self) -> dict:
        """How often each classifier was the deciding one."""
        from collections import Counter
        deciding = Counter()
        deciding_correct = Counter()
        deciding_wrong = Counter()

        for r in self.results:
            deciding[r.deciding_classifier] += 1
            if r.is_correct is True:
                deciding_correct[r.deciding_classifier] += 1
            elif r.is_correct is False:
                deciding_wrong[r.deciding_classifier] += 1

        contributions = {}
        for name in deciding:
            total = deciding[name]
            correct = deciding_correct.get(name, 0)
            wrong = deciding_wrong.get(name, 0)
            contributions[name] = {
                'total_decisions': total,
                'correct': correct,
                'wrong': wrong,
                'accuracy': correct / (correct + wrong) if (correct + wrong) > 0 else 0.0,
            }
        return contributions

    # =========================================================================
    # Trimmer analysis
    # =========================================================================

    def _trimmer_analysis(self) -> dict:
        """Analyze trimmer effectiveness across all emails."""
        from collections import Counter
        boundary_counts = Counter()
        no_boundary = 0
        boundary_by_label = {'H': Counter(), 'L': Counter()}

        for r in self.results:
            marker = r.context.boundary_marker
            label = r.true_label or 'unknown'
            if marker:
                boundary_counts[marker] += 1
                boundary_by_label[label][marker] += 1
            else:
                no_boundary += 1
                boundary_by_label[label]['none'] += 1

        return {
            'boundary_counts': dict(boundary_counts),
            'no_boundary': no_boundary,
            'boundary_by_label': {k: dict(v) for k, v in boundary_by_label.items()},
        }

    # =========================================================================
    # Report generation
    # =========================================================================

    def _format_metrics_block(self, name: str, m: dict) -> list:
        """Format a single metrics block as lines."""
        lines = []
        lines.append(f"{name} ({m['total']} emails)")
        lines.append(f"  H-F1 Score:   {m['h_f1']:.4f}")
        lines.append(f"  H-Precision:  {m['h_precision']:.4f}")
        lines.append(f"  H-Recall:     {m['h_recall']:.4f}")
        lines.append(f"  H-Accuracy:   {m['h_accuracy']:.4f}")
        lines.append(f"  L-F1 Score:   {m['l_f1']:.4f}")
        lines.append(f"  L-Precision:  {m['l_precision']:.4f}")
        lines.append(f"  L-Recall:     {m['l_recall']:.4f}")
        lines.append(f"  L-Accuracy:   {m['l_accuracy']:.4f}")
        lines.append(f"  FN%:          {m['fn_pct']:.2f}% ({m['fn_count']}/{m['total']})")
        lines.append(f"  FP%:          {m['fp_pct']:.2f}% ({m['fp_count']}/{m['total']})")
        return lines

    def print_report(self) -> str:
        """Generate and print a comprehensive evaluation report. Returns the report text."""
        m = self.metrics()
        errors = self._error_analysis()
        contributions = self._classifier_contributions()
        trimmer = self._trimmer_analysis()

        lines = []
        w = lines.append

        w("=" * 72)
        w("            EMAIL CLASSIFIER -- EVALUATION REPORT")
        w(f"            Run: {self.run_timestamp}")
        w("=" * 72)
        w("")

        # Runtime
        total_time = sum(self.elapsed_times)
        n = len(self.elapsed_times)
        avg_time = total_time / n if n else 0
        w("RUNTIME")
        w("-" * 40)
        w(f"  Total emails:       {n}")
        w(f"  Total time:         {total_time:.2f}s")
        w(f"  Avg per email:      {avg_time:.3f}s ({avg_time*1000:.1f}ms)")
        if self.elapsed_times:
            w(f"  Min:                {min(self.elapsed_times)*1000:.1f}ms")
            w(f"  Max:                {max(self.elapsed_times)*1000:.1f}ms")
        w("")

        # Pipeline config
        w("PIPELINE CONFIGURATION")
        w("-" * 40)
        w(self.pipeline.describe())
        w("")

        # --- Metrics by segment ---
        w("METRICS")
        w("-" * 40)
        for name, key in [('OVERALL', 'overall'), ('SEEN', 'seen'), ('INSCOPE', 'inscope'), ('OUTSCOPE', 'outscope')]:
            for line in self._format_metrics_block(name, m[key]):
                w(f"  {line}")
            w("")

        # --- Classifier Contributions ---
        w("CLASSIFIER CONTRIBUTIONS")
        w("-" * 40)
        w(f"  {'Classifier':<25s} {'Decisions':>9s} {'Correct':>8s} {'Wrong':>6s} {'Accuracy':>9s}")
        w(f"  {'-'*25} {'-'*9} {'-'*8} {'-'*6} {'-'*9}")
        for name, stats in sorted(contributions.items(), key=lambda x: -x[1]['total_decisions']):
            w(f"  {name:<25s} {stats['total_decisions']:9d} {stats['correct']:8d} "
              f"{stats['wrong']:6d} {stats['accuracy']:8.1%}")
        w("")

        # --- Trimmer Analysis ---
        w("TRIMMER EFFECTIVENESS")
        w("-" * 40)
        total_emails = m['overall']['total']
        w(f"  Boundary found:     {total_emails - trimmer['no_boundary']}/{total_emails}")
        w(f"  No boundary found:  {trimmer['no_boundary']}")
        w("  Boundaries used:")
        for marker, count in sorted(trimmer['boundary_counts'].items(), key=lambda x: -x[1]):
            w(f"    {marker:<25s}: {count}")
        w("")

        # --- Error Analysis ---
        fp_list = errors['false_positives']
        fn_list = errors['false_negatives']

        w("ERROR ANALYSIS")
        w("-" * 40)
        w(f"  False Positives (predicted H, actually L): {len(fp_list)}")
        for item in fp_list[:10]:
            w(f"    [{item['act_id']}] conf={item['confidence']:.2f} "
              f"decided_by={item['deciding_classifier']}")
            w(f"      boundary={item['boundary_marker']}, dept_msg_len={item['dept_msg_len']}")
            w(f"      reason: {item['reason'][:120]}")
            w(f"      dept_msg: \"{item['dept_msg_preview'][:120]}\"")
            w("")
        if len(fp_list) > 10:
            w(f"    ... and {len(fp_list) - 10} more false positives")
        w("")

        w(f"  False Negatives (predicted L, actually H): {len(fn_list)}")
        for item in fn_list[:10]:
            w(f"    [{item['act_id']}] conf={item['confidence']:.2f} "
              f"decided_by={item['deciding_classifier']}")
            w(f"      boundary={item['boundary_marker']}, dept_msg_len={item['dept_msg_len']}")
            w(f"      reason: {item['reason'][:120]}")
            w(f"      dept_msg: \"{item['dept_msg_preview'][:120]}\"")
            for cr in item['classifier_results']:
                w(f"        -> {cr['name']}: {cr['prediction']} ({cr['confidence']:.2f}) -- {cr['reason'][:80]}")
            w("")
        if len(fn_list) > 10:
            w(f"    ... and {len(fn_list) - 10} more false negatives")
        w("")

        w("=" * 72)
        w("                      END OF REPORT")
        w("=" * 72)

        report = '\n'.join(lines)
        print(report)
        return report

    # =========================================================================
    # Save logs
    # =========================================================================

    def save_logs(self, log_dir: str = None) -> dict:
        """
        Save detailed logs to files for analysis and future optimization.

        Creates:
            - per_email_log.csv: One row per email with all intermediate results
            - error_analysis.json: Detailed breakdown of every wrong prediction
            - metrics_summary.json: Overall metrics
            - report.txt: The full text report

        Returns dict of file paths created.
        
        Log directory naming:
            logs/{config_code}_{timestamp}/
            where config_code is 8 chars: {preprocessor_code}{classifier_code}
            Example: logs/CT_KRESZL_{timestamp}/
        """
        if log_dir is None:
            config_code = generate_pipeline_config_code(self.pipeline)
            log_dir = f"logs/{config_code}_{self.run_timestamp}"
        
        os.makedirs(log_dir, exist_ok=True)

        paths = {}

        # 1. Per-email tabular logs (CSV + Excel)
        rows = []
        for r in self.results:
            base = r.summary_dict()
            base.update({
                'is_seen': r.context.metadata.get('is_seen', ''),
                'in_scope': r.context.metadata.get('in_scope', ''),
                'segment': r.context.metadata.get('segment', ''),
                'original_email_body': r.context.raw_body,
                'cleaned_email_text': r.context.clean_text,
                'trimmed_dept_message': r.context.dept_message,
                'trimmed_template_text': r.context.template_text,
            })
            rows.append(base)

        df = pd.DataFrame(rows)
        csv_path = os.path.join(log_dir, 'per_email_log.csv')
        df.to_csv(csv_path, index=False, encoding='utf-8-sig')
        paths['per_email_csv'] = csv_path

        xlsx_path = os.path.join(log_dir, 'per_email_log.xlsx')
        df.to_excel(xlsx_path, index=False)
        paths['per_email_xlsx'] = xlsx_path

        # 2. Error analysis JSON
        errors = self._error_analysis()
        error_path = os.path.join(log_dir, 'error_analysis.json')
        with open(error_path, 'w', encoding='utf-8') as f:
            json.dump(errors, f, indent=2, ensure_ascii=False, default=str)
        paths['error_analysis'] = error_path

        # 3. Metrics summary JSON
        metrics_data = self.metrics()
        metrics_data['pipeline_config'] = {
            'mode': self.pipeline.mode,
            'confidence_threshold': self.pipeline.confidence_threshold,
            'preprocessors': [p.name for p in self.pipeline.preprocessors],
            'classifiers': [c.name for c, w in self.pipeline.classifiers],
        }
        metrics_data['classifier_contributions'] = self._classifier_contributions()
        metrics_data['trimmer_analysis'] = self._trimmer_analysis()
        metrics_path = os.path.join(log_dir, 'metrics_summary.json')
        with open(metrics_path, 'w', encoding='utf-8') as f:
            json.dump(metrics_data, f, indent=2, ensure_ascii=False, default=str)
        paths['metrics_summary'] = metrics_path

        # 4. Full text report
        report = self.print_report()
        report_path = os.path.join(log_dir, 'report.txt')
        with open(report_path, 'w', encoding='utf-8') as f:
            f.write(report)
        paths['report'] = report_path

        print(f"\nLogs saved to: {log_dir}/")
        for name, path in paths.items():
            print(f"  {name}: {path}")

        return paths