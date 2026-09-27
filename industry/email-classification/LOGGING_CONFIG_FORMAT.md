# Pipeline Configuration Code Format

## Overview

The logging system now generates directory names that encode the pipeline configuration. This makes it easy to identify what processing steps and classifiers were used just by looking at the log directory name.

## Format

```
logs/{config_code}_{timestamp}/
```

Where:
- `{config_code}`: 8-character code representing pipeline configuration
- `{timestamp}`: YYYYMMDD_HHMMSS (e.g., 20260305_181742)

## Configuration Code Breakdown

The 8-character code is structured as: `{preprocessor_code}{classifier_code}`

### Preprocessor Code (First 2 Characters)

- **Position 1**: HTML Cleaner
  - `C` = HTML Cleaner enabled
  - `0` = HTML Cleaner disabled

- **Position 2**: Email Trimmer
  - `T` = Email Trimmer enabled
  - `0` = Email Trimmer disabled

**Examples:**
- `CT` = Both cleaners enabled
- `C0` = Only HTML Cleaner enabled
- `0T` = Only Email Trimmer enabled
- `00` = No preprocessing

### Classifier Code (Last 6 Characters)

The 6 characters represent, in order:
1. **K**eyword Scorer: `K` if used, `0` if not
2. **R**eply Slip Classifier: `R` if used, `0` if not
3. **E**mbedding KNN: `E` if used, `0` if not
4. **S**etFit: `S` if used, `0` if not
5. **Z**ero Shot NLI: `Z` if used, `0` if not
6. **L**LM Classifier: `L` if used, `0` if not

**Examples:**
- `KRESZL` = All 6 classifiers enabled
- `000000` = No classifiers (invalid, but possible)
- `K0ES00` = Keyword Scorer, Embedding KNN, and SetFit enabled
- `000000L` = Only LLM classifier enabled

## Log Directory Examples

### Example 1: Current Configuration
Current config uses: HTML Cleaner + Email Trimmer + LLM

```
logs/CT_000000L_20260305_181742/
```

**Interpretation:**
- `CT`: Both HTML cleaner and email trimmer are enabled
- `000000L`: Only LLM classifier is enabled

### Example 2: All Components Enabled
Using all preprocessors and all classifiers

```
logs/CT_KRESZL_20260305_181742/
```

**Interpretation:**
- `CT`: Both preprocessing steps enabled
- `KRESZL`: All 6 classifiers enabled

### Example 3: Minimal Configuration
Only LLM, no preprocessing

```
logs/00_000000L_20260305_181742/
```

**Interpretation:**
- `00`: No preprocessing
- `000000L`: Only LLM classifier

### Example 4: Keyword + Embedding + SetFit
Only HTML cleaning, using Keyword Scorer + Embedding KNN + SetFit

```
logs/C0_K0ES00_20260305_181742/
```

**Interpretation:**
- `C0`: Only HTML cleaner enabled
- `K0ES00`: Keyword Scorer, Embedding KNN, and SetFit enabled

## Implementation Details

The configuration code is generated automatically by the `generate_pipeline_config_code()` function in `evaluator.py`. This function:

1. Inspects `pipeline.preprocessors` to check for "html_cleaner" and "email_trimmer"
2. Inspects `pipeline.classifiers` to check for all 6 classifier names
3. Generates the appropriate 8-character code

## Backward Compatibility

- If you provide an explicit `log_dir` parameter to `save_logs()`, the code generation is skipped
- Existing log directories are not affected; only new runs will use the new naming scheme

## Benefits

1. **Easy Identification**: Quickly see which configuration was used without opening files
2. **Reproducibility**: Archive logs with their configurations encoded in the name
3. **Experimentation**: Easier to compare results between different pipeline configurations
4. **Historical Tracking**: Build a history of experiments with visible configuration differences
