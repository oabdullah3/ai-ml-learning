# Email Priority Classifier

A modular ML pipeline that triages incoming emails to a **government citizen hotline**, flagging which ones were sent to the wrong department and need to be **reassigned** (`H` = high priority) versus those being handled normally (`L` = low priority).

Built during a software-engineering internship at an AI company working with a public-sector client. The client is not named here; the domain — "which complaints landed in the wrong inbox?" — is generic and reproducible.

## The problem

A hotline receives complaints and routes them to the responsible department. Departments reply through a standard template, and one of the first things a reply can say is effectively *"this isn't ours — please send it elsewhere."*

Spotting those mis-routing signals is what this pipeline automates:

- **H (High)** — the reply requests reassignment, referral, or transfer to another department.
- **L (Low)** — the reply acknowledges, investigates, or resolves the complaint in place.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐     ┌───────────┐
│  Excel/CSV  │ ──▶ │ Preprocessors│ ──▶ │    Classifiers   │ ──▶ │ Evaluator │
│  (raw data) │     │ (sequential) │     │ (weighted ensemble) │   │ (metrics) │
└─────────────┘     └──────────────┘     └──────────────────┘     └───────────┘
```

### Preprocessors (run in order)

| # | Name | Description |
|---|------|-------------|
| 1 | `HtmlCleaner` | Strips HTML, decodes entities, normalises whitespace. |
| 2 | `EmailTrimmer` | Splits the cleaned text at the first boundary marker (forwarded template / reply slip) to isolate the **department's own message** from the boilerplate below it. |

### Pipeline modes

| Mode | Behaviour |
|------|-----------|
| `weighted_ensemble` (default) | Every classifier votes; weighted confidence is summed per class; highest total wins. |
| `first_confident` | Classifiers run in order; the first to reach the confidence threshold decides. |

All tunable knobs live in `email_classifier/config.py` (`PIPELINE_MODE`, `CONFIDENCE_THRESHOLD`, `DEFAULT_PREDICTION`, per-classifier weights, etc.).

## Classifiers

| Name | Approach | Notes |
|------|----------|-------|
| `embedding_knn` | Encode text with `paraphrase-multilingual-MiniLM-L12-v2`, classify by similarity-weighted k-NN over a reference set. | Generalises to unseen text; ~37 ms/email; no training step. |
| `setfit` | Fine-tune the same MiniLM base with contrastive learning, then a logistic head. Cached to disk. | Best seen-data score; ~40 s first-time training. |
| `llm` | Prompt an LLM through the OpenRouter API and parse a structured JSON verdict. | Zero-shot; system prompt fully config-driven; requires `OPENROUTER_API_KEY`. |

## Results

> Metrics per segment: **H-F1**, **accuracy**, **FP %**, **FN %**. `OUTSCOPE` has no `H` examples, so **L-F1** is reported there instead. These figures come from the logged evaluation runs in the original (non-public) workspace.

### Best combination: `embedding_knn` + `setfit`

| Segment | H-F1 | Accuracy | FP % | FN % |
|---------|-------|----------|------|------|
| OVERALL (262) | **0.8730** | **0.9389** | 5.34 % | 0.76 % |
| SEEN (130) | **1.0000** | **1.0000** | 0.00 % | 0.00 % |
| INSCOPE (52) | **0.8000** | **0.9231** | 3.85 % | 3.85 % |
| OUTSCOPE (80) | L-F1 = 0.9189 | 0.8500 | 15.00 % | 0.00 % |

### Adding a keyword signal on top: `keyword_scorer` + `embedding_knn` + `setfit`

| Segment | H-F1 | Accuracy | FP % | FN % |
|---------|-------|----------|------|------|
| OVERALL (262) | **0.9009** | **0.9580** | 1.53 % | 2.67 % |
| INSCOPE (52) | 0.5333 | 0.8654 | 1.92 % | 11.54 % |

**Takeaway:** the embedding ensemble generalises best to unseen emails from known departments (INSCOPE H-F1 = 0.80), and adding a deterministic keyword scorer pushes overall accuracy above 0.95 — at the cost of in-scope recall.

## Data

The labeled dataset (262 real emails, `H`/`L` labeled) is **not included** — it contains real complaint correspondence. The pipeline accepts any CSV/Excel with these columns:

- `EMAIL_BODY` — the raw email text.
- `LABELLED_PRIORITY` — ground truth `H`/`L`.
- `EMAIL_TITLE`, `ACT_ID` — optional.

The evaluation script splits data into four segments:

| Split | Count | H | L | Purpose |
|-------|-------|---|---|---------|
| SEEN | 130 | 47 | 83 | Reference set for k-NN + SetFit training. |
| INSCOPE | 52 | 10 | 42 | Unseen emails from known departments — the real generalisation test. |
| OUTSCOPE | 80 | 0 | 80 | Emails from never-seen departments (all `L`) — false-positive control. |
| OVERALL | 262 | 57 | 205 | Full dataset. |

## Quick start

```bash
python3 -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install pandas openpyxl beautifulsoup4 lxml scikit-learn sentence-transformers setfit "transformers<=4.57.6" torch sentencepiece protobuf requests python-dotenv

# 1. Put a CSV/Excel file in the project root (EMAIL_BODY + LABELLED_PRIORITY columns)
# 2. Toggle classifiers in email_classifier/config.py (ADD_EMBEDDING_KNN, ADD_SETFIT, ADD_LLM)
# 3. If using the LLM classifier, set OPENROUTER_API_KEY
# 4. Run
python run_pipeline.py
```

Logs are written to `logs/<timestamp>/` with a full report and per-email CSV.

Two companion scripts are included for exploration:

- `python email_data_eval.py` — structural/content analysis of a dataset (boundary markers, keyword effectiveness, difficulty breakdown).
- `python configuration_testing.py` — sweeps a grid of classifier/preprocessor configurations and compares H-F1 across segments.

## Project structure

```
email-classification/
├── run_pipeline.py                       # Entry point
├── email_data_eval.py                    # Data exploration / eval report
├── configuration_testing.py              # Config sweep experiments
├── LOGGING_CONFIG_FORMAT.md              # How log dir names encode config
└── email_classifier/
    ├── config.py                         # All tunable parameters
    ├── core.py                           # EmailContext, ClassificationResult, ABCs
    ├── pipeline.py                       # Ensemble / first-confident orchestration
    ├── evaluator.py                      # Segmented metrics + error analysis
    ├── preprocessors/
    │   ├── html_cleaner.py               # Strip HTML
    │   └── trimmer.py                    # Extract department message
    └── classifiers/
        ├── embedding_knn.py              # Sentence-embedding k-NN
        ├── setfit_classifier.py          # SetFit fine-tuned classifier
        └── llm_classifier.py             # LLM (OpenRouter) classifier
```
