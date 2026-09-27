"""
Configuration for the Email Priority Classifier pipeline.

All tunable parameters in one place. Classifiers and preprocessors
import from here so there's a single source of truth.
"""

# =============================================================================
# Boundary markers (ordered by priority for splitting)
# =============================================================================
# Each entry: (name, regex_pattern)
# The trimmer tries these in order and uses the FIRST match found.
BOUNDARY_MARKERS = [
    ("Original Message",  r'-{3,}\s*Original\s+Message\s*-{3,}'),
    ("From hotline",         r'From:?\s*[^<\n]*?hotline@example\.gov'),
    ("Reply Slip",        r'--\s*Reply\s+Slip\s+V0[0-9]\s*--'),
    ("CASE# ref",         r'CASE#\d+-\d+'),
    ("hotline Refers",       r'To:\s*-?\s*[A-Z].*?We\s+would\s+like\s+to\s+refer'),
    ("Distribution List", r'Distribution\s+List\s*-'),
]

# Additional fallback boundary markers (tried if none of the above match)
FALLBACK_BOUNDARY_MARKERS = [
    ("To hotline block",     r'To\s*:\s*hotline\s'),
    ("CASE tag",          r'<CASE>\s*:'),
    ("CMIS header",       r'CMIS#\s*:'),
    ("Sent date line",    r'Sent:\s*\w+day,\s+\w+\s+\d+'),
]

# =============================================================================
# Pipeline configuration
# =============================================================================

# Default pipeline mode: 'first_confident' or 'weighted_ensemble'
# first_confident: use the first classifier that returns confidence >= threshold
# weighted_ensemble: combine all classifier scores
PIPELINE_MODE = 'weighted_ensemble'

# Minimum confidence for a classifier to be decisive in 'first_confident' mode
CONFIDENCE_THRESHOLD = 0.3

# Default prediction when no classifier is confident enough
DEFAULT_PREDICTION = 'L'

# =============================================================================
# Logging
# =============================================================================
LOG_DIR = 'logs'
LOG_LEVEL = 'DEBUG'  # DEBUG, INFO, WARNING

# =============================================================================
# Pipeline Controls (toggle classifiers on/off)
# =============================================================================
ADD_EMBEDDING_KNN = False
ADD_SETFIT = False
ADD_LLM = True
ENABLE_CLEANING = True
ENABLE_TRIMMING = True

# =============================================================================
# Embedding k-NN Configuration
# =============================================================================

# HuggingFace sentence-transformer model name.
# Changing this swaps the embedding model entirely.  Must be a valid model on HF Hub.
# str — e.g. "paraphrase-multilingual-MiniLM-L12-v2", "all-MiniLM-L6-v2"
KNN_MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"

# Number of nearest neighbors to vote on each prediction.
# Higher k = smoother predictions but slower; lower k = noisier but faster.
# int >= 1 — typical range: 3–15
KNN_K = 7

# Minimum average cosine similarity among the k neighbors to make a prediction.
# Below this the classifier abstains (returns None → falls back to default L).
# float 0.0–1.0 — lower = more aggressive (fewer abstentions), higher = more conservative
KNN_MIN_SIMILARITY = 0.30

# Fraction of weighted H-score over total required to predict H (lenient mode).
# Used when avg_sim >= KNN_SIMILARITY_PIVOT and no L-indicator phrases are found.
# float 0.0–1.0 — lower = more H predictions, higher = fewer H predictions
KNN_H_RATIO_THRESHOLD = 0.60

# Stricter H threshold used when avg_sim is low OR L-indicator phrases are detected.
# float 0.0–1.0 — should be >= KNN_H_RATIO_THRESHOLD
KNN_H_RATIO_STRICT = 0.70

# avg_sim cutoff that selects between lenient and strict H thresholds.
# If avg_sim >= this value, lenient threshold is used; otherwise strict.
# float 0.0–1.0
KNN_SIMILARITY_PIVOT = 0.55

# Confidence scaling divisor.  Final confidence is scaled by min(avg_sim / this, 1.0).
# Higher = more conservative confidence scores; lower = more generous.
# float > 0.0 — typical: 0.3–0.7
KNN_CONFIDENCE_SCALE = 0.5

# Batch size for encoding reference embeddings at init.
# Only affects speed/memory, not accuracy.  Larger = faster but more VRAM.
# int >= 1 — typical: 32–256
KNN_ENCODE_BATCH_SIZE = 64

# Pipeline weight for k-NN in weighted_ensemble mode.
# Higher = k-NN has more influence relative to other classifiers.
# float > 0.0
KNN_WEIGHT = 1.0

# L-indicator regex patterns.  If the input text matches ANY of these,
# the classifier uses KNN_H_RATIO_STRICT instead of KNN_H_RATIO_THRESHOLD,
# because these phrases suggest the department is handling (L), not reassigning.
# list of raw regex strings (case-insensitive matching applied automatically)
KNN_L_INDICATOR_PATTERNS = [
    r"acknowledge[sd]?\s+(the\s+)?receipt",
    r"case\s+is\s+being\s+process",
    r"will\s+(be\s+)?look(?:ed|ing)?\s+into",
    r"please\s+log\s+the\s+case",
    r"has\s+been\s+(?:assigned|referred|forwarded)\s+to",
    r"(?:taken?|taking|will\s+take)\s+follow[\s-]*up\s+action",
    r"arranged\s+(?:for\s+)?(?:inspection|investigation|site\s+visit)",
    r"taken?\s+(?:follow[\s-]*up|appropriate)\s+action",
    r"(?:已|將)(?:跟進|處理|安排)",  # Chinese: already/will follow up/handle/arrange
]

# H-indicator regex patterns.  If the input text matches ANY of these,
# the classifier uses KNN_H_RATIO_LENIENT instead of the normal threshold,
# because these phrases suggest the department is requesting reassignment (H).
# list of raw regex strings (case-insensitive matching applied automatically)
KNN_H_INDICATOR_PATTERNS = [
    r"please\s+(?:refer|forward|reassign|transfer|redirect)\s+(?:this\s+)?(?:case|complaint|matter)",
    r"(?:should|needs?\s+to)\s+be\s+(?:referred|forwarded|reassigned|transferred)",
    r"incorrectly\s+assigned",
    r"not\s+under\s+(?:our|this)\s+(?:department|purview|jurisdiction)",
    r"does\s+not\s+fall\s+(?:under|within)",
    r"(?:kindly|please)\s+forward\s+(?:the\s+)?case",
    r"refer\s+(?:this\s+)?case\s+to",
    r"(?:re-?assign|re-?route)\s+(?:this\s+)?(?:case|complaint)",
]

# When H-indicators are detected, use this lenient threshold instead of
# the normal/strict thresholds.  Should be <= KNN_H_RATIO_THRESHOLD.
# float 0.0–1.0
KNN_H_RATIO_LENIENT = 0.40

# =============================================================================
# SetFit Configuration
# =============================================================================

# HuggingFace sentence-transformer model to fine-tune.
# str — must be a valid sentence-transformers model on HF Hub
SETFIT_MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"

# Number of contrastive learning epochs.
# More epochs = better separation but longer training and overfitting risk.
# int >= 1 — typical: 1–5
SETFIT_NUM_EPOCHS = 2

# Training batch size.
# Larger = faster training, more memory.  Does not strongly affect accuracy.
# int >= 1 — typical: 8–64
SETFIT_BATCH_SIZE = 64

# Number of text pairs to generate per class for contrastive learning.
# More iterations = more training pairs = better clusters but slower.
# int >= 1 — typical: 5–30
SETFIT_NUM_ITERATIONS = 15

# Maximum training steps.  Caps training even if epochs/iterations would go further.
# -1 = no cap (train for the full num_epochs * num_iterations schedule).
# int — typical: 50–500  or  -1
SETFIT_MAX_STEPS = 100

# Force retrain even if a cached model exists for the same data+config fingerprint.
# bool — True = always retrain, False = use cache when available
SETFIT_FORCE_RETRAIN = False

# Pipeline weight for SetFit in weighted_ensemble mode.
# float > 0.0
SETFIT_WEIGHT = 1.0

# =============================================================================
# LLM Classifier Configuration (OpenRouter API)
# =============================================================================

from dotenv import load_dotenv
load_dotenv()  # Load environment variables from .env file (e.g. OPENROUTER_API_KEY)

# OpenRouter API key.  Set via environment variable for security:
#   export OPENROUTER_API_KEY="sk-or-..."
# Falls back to this value if the env var is not set.  NEVER commit a real key.
LLM_API_KEY = ""

# OpenRouter base URL.
LLM_API_BASE = "https://openrouter.ai/api/v1/chat/completions"

# Model identifier on OpenRouter (see https://openrouter.ai/models).
# str — e.g. "google/gemini-2.0-flash-001", "anthropic/claude-3.5-sonnet"
LLM_MODEL = "arcee-ai/trinity-large-preview:free"

# Max tokens for the LLM response.  Our expected output is tiny (~20 tokens).
# int >= 1
LLM_MAX_TOKENS = 50

# Temperature.  0.0 = deterministic, higher = more creative.
# float 0.0–2.0 — use 0.0 for classification
LLM_TEMPERATURE = 0.0

# Request timeout in seconds.
# float > 0
LLM_TIMEOUT = 30.0

# Retry settings for transient API failures (timeouts, 429, 5xx).
# int >= 0 — number of retries after the first attempt
LLM_MAX_RETRIES = 4

# Base delay in seconds between retries (doubles each attempt).
# float > 0
LLM_RETRY_DELAY = 2.0

# Pipeline weight for LLM classifier in weighted_ensemble mode.
# float > 0.0
LLM_WEIGHT = 1.0

# System prompt.  Sent once per request as the system role.
# Keep compact.  Use {label_h} and {label_l} placeholders for class names.
LLM_SYSTEM_PROMPT = (
    "You classify government hotline complaint-handling emails. "
    "Each email is a department's response to a complaint forwarded by the hotline. "
    "Classify as {label_h} or {label_l}.\n"
    "{label_h}: The department is requesting reassignment, referral, or transfer of the case "
    "to another department — even if phrased politely (e.g. 'please refer', 'kindly forward', "
    "'not under our purview', 'does not fall within our jurisdiction').\n"
    "{label_l}: The department is acknowledging, investigating, handling, or has already "
    "resolved the complaint itself — no reassignment requested.\n"
    "Reply with ONLY a JSON object: {{\"prediction\": \"{label_h}\" or \"{label_l}\", "
    "\"confidence\": 0.0-1.0, \"reason\": \"one sentence\"}}"
)

# User prompt template.  {text} is replaced with the email content at runtime.
LLM_USER_PROMPT = "Classify this department response:\n\n{text}"
