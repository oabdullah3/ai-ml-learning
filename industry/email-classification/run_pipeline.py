"""
Email Priority Classifier -- Main entry point.
"""

import sys
import os
import glob
import pandas as pd

from email_classifier.pipeline import Pipeline
from email_classifier.preprocessors.html_cleaner import HtmlCleaner
from email_classifier.preprocessors.trimmer import EmailTrimmer
from email_classifier.classifiers.embedding_knn import EmbeddingKNNClassifier
from email_classifier.classifiers.setfit_classifier import SetFitClassifier
from email_classifier.classifiers.llm_classifier import LLMClassifier
from email_classifier.evaluator import Evaluator

from email_classifier.config import ADD_EMBEDDING_KNN, ADD_SETFIT, ADD_LLM, ENABLE_CLEANING, ENABLE_TRIMMING
from email_classifier import config


def find_data_file() -> str:
    """Auto-detect CSV or Excel file in current directory."""
    for pattern in ['*.csv', '*.xlsx', '*.xls']:
        files = glob.glob(pattern)
        if files:
            return files[0]
    raise FileNotFoundError("No CSV or Excel file found in current directory")


def load_data(path: str) -> pd.DataFrame:
    """Load data from CSV or Excel."""
    if path.endswith('.csv'):
        df = pd.read_csv(path, encoding='utf-8-sig')
    else:
        df = pd.read_excel(path)

    # Normalize column names: strip, replace spaces with underscores, uppercase
    df.columns = [c.strip().replace(' ', '_').upper() for c in df.columns]

    # Validate required columns
    required = ['EMAIL_BODY', 'LABELLED_PRIORITY']
    for col in required:
        if col not in df.columns:
            raise ValueError(f"Missing required column: {col}")

    # Fill NaN in optional columns
    if 'EMAIL_TITLE' not in df.columns:
        df['EMAIL_TITLE'] = ''
    if 'ACT_ID' not in df.columns:
        df['ACT_ID'] = range(len(df))

    df['EMAIL_BODY'] = df['EMAIL_BODY'].fillna('')
    df['EMAIL_TITLE'] = df['EMAIL_TITLE'].fillna('')
    df['ACT_ID'] = df['ACT_ID'].astype(str)

    return df


def build_reference_set(seen_df: pd.DataFrame) -> list[dict]:
    """
    Preprocess SEEN emails and build reference dicts for k-NN.

    Each reference = {"text": <preprocessed dept_message or clean_text>, "label": "H"|"L"}
    """
    cleaner = HtmlCleaner()
    trimmer = EmailTrimmer()
    references = []

    for _, row in seen_df.iterrows():
        from email_classifier.core import EmailContext
        ctx = EmailContext(
            raw_body=str(row.get('EMAIL_BODY', '')),
            email_title=str(row.get('EMAIL_TITLE', '')) if pd.notna(row.get('EMAIL_TITLE')) else None,
            act_id=str(row.get('ACT_ID', '')),
            true_label=str(row.get('LABELLED_PRIORITY', '')).strip().upper(),
        )
        if ENABLE_CLEANING: cleaner.process(ctx)
        if ENABLE_TRIMMING: trimmer.process(ctx)

        text = ctx.dept_message or ctx.clean_text
        if text and text.strip() and ctx.true_label in ('H', 'L'):
            references.append({"text": text, "label": ctx.true_label})

    return references


def build_pipeline(references: list[dict] = None) -> Pipeline:
    """
    Build the classification pipeline.

    Configure which classifiers are active and their weights here.
    Comment/uncomment to enable/disable components.

    Weights only matter in 'weighted_ensemble' mode (set in config.py).
    In 'first_confident' mode, order matters instead.
    """
    pipe = Pipeline()  # reads mode from config.py

    # --- Preprocessors (order matters) ---
    if ENABLE_CLEANING: pipe.add_preprocessor(HtmlCleaner())
    if ENABLE_TRIMMING: pipe.add_preprocessor(EmailTrimmer())

    # --- Classifiers (toggle on/off by commenting, adjust weights) ---
    #1. Embedding k-NN (semantic similarity -- generalizes to unseen)
    if ADD_EMBEDDING_KNN:
        if references:
            knn = EmbeddingKNNClassifier(references=references)
            pipe.add_classifier(knn, weight=config.KNN_WEIGHT)
        else:
            print("WARNING: No references provided, skipping EmbeddingKNNClassifier")

    #2. SetFit (fine-tuned sentence-transformer -- best for generalizing to unseen)
    if ADD_SETFIT:
        if references:
            sf = SetFitClassifier(references=references)
            pipe.add_classifier(sf, weight=config.SETFIT_WEIGHT)
        else:
            print("WARNING: No references provided, skipping SetFitClassifier")

    #3. LLM via OpenRouter API (general-purpose, no training needed)
    if ADD_LLM:
        llm = LLMClassifier()
        pipe.add_classifier(llm, weight=config.LLM_WEIGHT)

    return pipe


def main():
    # Load data
    if len(sys.argv) > 1:
        data_path = sys.argv[1]
    else:
        data_path = find_data_file()

    print(f"Loading data from: {data_path}")
    df = load_data(data_path)
    print(f"Loaded {len(df)} emails")

    # Split seen data for k-NN reference set
    references = []
    if 'IS_SEEN' in df.columns:
        seen_df = df[df['IS_SEEN'].astype(str).str.strip().str.upper() == 'TRUE'].copy()
        print(f"Found {len(seen_df)} SEEN emails for k-NN reference set")
        references = build_reference_set(seen_df)
        print(f"Built {len(references)} reference examples")
    else:
        print("No IS_SEEN column found -- using all data as reference (may overfit)")
        references = build_reference_set(df)

    # Build pipeline
    pipe = build_pipeline(references=references)

    # Evaluate
    evaluator = Evaluator(pipe)
    evaluator.run(df)
    evaluator.print_report()
    evaluator.save_logs()


if __name__ == '__main__':
    main()