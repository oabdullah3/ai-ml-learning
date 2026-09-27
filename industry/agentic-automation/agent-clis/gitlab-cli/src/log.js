"use strict";

// ── Module: Telemetry Logging ──────────────────────────────────────────
//
// Saves structured JSON logs locally to log_payloads/ and sends simplified
// versions to a telemetry API. Modeled on Confluence CLI's src/log.js
// (~300 lines, simpler reference), adapted for GitLab CLI's 16 commands.
//
// Design decisions:
//   - saveLog() NEVER throws — outermost try/catch returns errors object
//   - Local save FIRST (full payload), API POST SECOND (simplified)
//   - Local and API are fully independent — each wrapped in its own try/catch
//   - simplifyResultForLog() always deep-copies before mutating
//   - skipLog() for --help, --version, doctor-credentials, unknown-command

const fs = require("fs");
const path = require("path");
const os = require("os");

// ── Module-level state ──────────────────────────────────────────────────

/** @type {string|null} Path set by --env-dir for .env resolution */
let _envDir = null;

/** @type {boolean} When true, saveLog() returns null without any work */
let _skipLog = false;

// ── Hardcoded fallback for telemetry API URL ────────────────────────────

const DEFAULT_API_URL = "https://telemetry.example.invalid/api/v1/logs";

// ── 1. Control functions ────────────────────────────────────────────────

/**
 * Sets the env-dir path for dotenv file resolution.
 * Called from cli.js after parsing --env-dir.
 * @param {string|null} envDir
 */
function setEnvDir(envDir) {
  _envDir = envDir || null;
}

/**
 * Disables all logging for the current command invocation.
 * Called for --help, --version, doctor-credentials, unknown-command.
 */
function skipLog() {
  _skipLog = true;
}

// ── 2. Dotenv file reader ───────────────────────────────────────────────

/**
 * Strips wrapping single or double quotes from a value string.
 * Handles unbalanced quotes gracefully (if only one side is quoted, strips it).
 * @param {string} value
 * @returns {string}
 */
function stripWrappingQuotes(value) {
  const s = value.trim();
  if (s.length >= 2) {
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      return s.slice(1, -1);
    }
  }
  return s;
}

/**
 * Parses a .env file at the given path into a key/value object.
 * Handles export prefix, inline comments, quotes, and blank/comment lines.
 * Returns empty object if the file doesn't exist or can't be read.
 * @param {string} filePath - Absolute path to the .env file
 * @returns {Record<string, string>}
 */
function readDotEnvFile(filePath) {
  const result = {};
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (_) {
    return result;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    // Skip blank lines and full-line comments
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Strip 'export ' prefix
    const valueLine = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;

    // Split on first '='
    const eq = valueLine.indexOf("=");
    if (eq < 1) continue;

    const key = valueLine.slice(0, eq).trim();
    const rawValue = stripWrappingQuotes(valueLine.slice(eq + 1).trim());

    // Strip inline comments (hash not inside quotes)
    const hashIdx = rawValue.indexOf("#");
    const value = hashIdx >= 0 ? rawValue.slice(0, hashIdx).trim() : rawValue;

    result[key] = value;
  }
  return result;
}

// ── 3. Log directory resolution ─────────────────────────────────────────

/**
 * Resolves the log_payloads directory: tries cwd first, then home.
 * Creates the directory if it doesn't exist.
 * Returns null if neither location is writable.
 * @returns {string|null}
 */
function getLogPayloadsDir() {
  const candidates = [
    path.join(process.cwd(), "log_payloads"),
    path.join(os.homedir(), "log_payloads"),
  ];

  for (const dir of candidates) {
    try {
      // Create if needed (recursive for date-stamped subdirs)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Verify writable by testing access
      fs.accessSync(dir, fs.constants.W_OK);
      return dir;
    } catch (_) {
      // Try next candidate
    }
  }
  return null;
}

// ── 4. API key resolution ───────────────────────────────────────────────

/**
 * Resolution ladder for TELEMETRY_API_KEY:
 *   1. process.env.TELEMETRY_API_KEY
 *   2. <env-dir>/.env  (via --env-dir)
 *   3. <cwd>/.env
 *   4. ~/.env
 * @returns {string|null}
 */
function getTelemetryApiKey() {
  // 1. process.env
  if (process.env.TELEMETRY_API_KEY) {
    return process.env.TELEMETRY_API_KEY;
  }

  // 2. <env-dir>/.env
  if (_envDir) {
    const key = readDotEnvFile(path.join(_envDir, ".env")).TELEMETRY_API_KEY;
    if (key) return key;
  }

  // 3. <cwd>/.env
  const cwdKey = readDotEnvFile(path.join(process.cwd(), ".env")).TELEMETRY_API_KEY;
  if (cwdKey) return cwdKey;

  // 4. ~/.env
  const homeKey = readDotEnvFile(path.join(os.homedir(), ".env")).TELEMETRY_API_KEY;
  if (homeKey) return homeKey;

  return null;
}

// ── 5. API URL resolution ───────────────────────────────────────────────

/**
 * Resolution ladder for TELEMETRY_API_URL:
 *   1. process.env.TELEMETRY_API_URL
 *   2. <env-dir>/.env
 *   3. <cwd>/.env
 *   4. ~/.env
 *   5. Hardcoded fallback: https://telemetry.example.invalid/api/v1/logs
 * @returns {string}
 */
function getTelemetryApiUrl() {
  // 1. process.env
  if (process.env.TELEMETRY_API_URL) {
    return process.env.TELEMETRY_API_URL;
  }

  // 2. <env-dir>/.env
  if (_envDir) {
    const url = readDotEnvFile(path.join(_envDir, ".env")).TELEMETRY_API_URL;
    if (url) return url;
  }

  // 3. <cwd>/.env
  const cwdUrl = readDotEnvFile(path.join(process.cwd(), ".env")).TELEMETRY_API_URL;
  if (cwdUrl) return cwdUrl;

  // 4. ~/.env
  const homeUrl = readDotEnvFile(path.join(os.homedir(), ".env")).TELEMETRY_API_URL;
  if (homeUrl) return homeUrl;

  // 5. Hardcoded fallback
  return DEFAULT_API_URL;
}

// ── 6. Simplification toggle ────────────────────────────────────────────

/**
 * Resolution ladder for LOG_SIMPLIFICATION_ENABLED:
 *   1. process.env.LOG_SIMPLIFICATION_ENABLED
 *   2. <env-dir>/.env  (via --env-dir)
 *   3. <cwd>/.env
 *   4. ~/.env
 * Defaults to true (simplification enabled).
 * @returns {boolean}
 */
function isSimplificationEnabled() {
  // 1. process.env
  if (process.env.LOG_SIMPLIFICATION_ENABLED !== undefined) {
    return process.env.LOG_SIMPLIFICATION_ENABLED.toLowerCase() !== "false";
  }

  // 2. <env-dir>/.env
  if (_envDir) {
    const val = readDotEnvFile(path.join(_envDir, ".env")).LOG_SIMPLIFICATION_ENABLED;
    if (val !== undefined) return val.toLowerCase() !== "false";
  }

  // 3. <cwd>/.env
  const cwdVal = readDotEnvFile(path.join(process.cwd(), ".env")).LOG_SIMPLIFICATION_ENABLED;
  if (cwdVal !== undefined) return cwdVal.toLowerCase() !== "false";

  // 4. ~/.env
  const homeVal = readDotEnvFile(path.join(os.homedir(), ".env")).LOG_SIMPLIFICATION_ENABLED;
  if (homeVal !== undefined) return homeVal.toLowerCase() !== "false";

  // Default: enabled
  return true;
}

// ── 7. Result simplification ────────────────────────────────────────────

/**
 * Deep-copies a result object then simplifies it for API transmission.
 * Preserves IDs, counts, status fields, summary messages.
 * Drops raw content bodies, full diffs, local file paths.
 * Replaces arrays with counts, large strings with lengths.
 *
 * The original result passed by the caller is NEVER mutated — a deep copy
 * is always the first operation.
 *
 * @param {string} command - Human-readable command name (e.g., "repo search")
 * @param {*} result - The raw result object from the command
 * @returns {*} Simplified (deep-copied) result safe for API transmission
 */
function simplifyResultForLog(command, result) {
  // Deep-copy FIRST — original result is never mutated
  if (result === null || result === undefined) return result;
  let copy;
  try {
    copy = JSON.parse(JSON.stringify(result));
  } catch (_) {
    // If result can't be serialized (circular refs, etc.), return a safe fallback
    return { _simplificationError: "Cannot deep-copy result" };
  }

  switch (command) {
    // ── Read-only commands ──

    case "me":
      // Already compact (id, username, name, email, web_url). No changes.
      break;

    case "repo search":
      if (copy.items && Array.isArray(copy.items)) {
        copy.retrievedItems = copy.items.length;
        delete copy.items;
      }
      break;

    case "repo clone":
      // Drop local path info
      delete copy.repoDir;
      delete copy.cloneRoot;
      delete copy.canonicalRepoKey;
      break;

    case "repo status":
      if (copy.changedFiles && Array.isArray(copy.changedFiles)) {
        copy.changedFilesCount = copy.changedFiles.length;
        delete copy.changedFiles;
      }
      if (typeof copy.diffStat === "string" && copy.diffStat.length > 160) {
        copy.diffStat = copy.diffStat.substring(0, 160) + "...";
      }
      break;

    case "repo file search":
      if (copy.files && Array.isArray(copy.files)) {
        copy.retrievedFiles = copy.files.length;
        delete copy.files;
      }
      break;

    case "repo file read":
      if (copy.file && typeof copy.file === "object") {
        if (typeof copy.file.content === "string") {
          copy.file.contentLength = copy.file.content.length;
          delete copy.file.content;
        }
      }
      break;

    case "repo branch list":
      if (copy.branches && Array.isArray(copy.branches)) {
        copy.retrievedBranches = copy.branches.length;
        delete copy.branches;
      }
      break;

    case "repo mr list":
      if (copy.mergeRequests && Array.isArray(copy.mergeRequests)) {
        copy.retrievedMRs = copy.mergeRequests.length;
        delete copy.mergeRequests;
      }
      break;

    case "repo mr diff":
      if (copy.diffs && Array.isArray(copy.diffs)) {
        copy.retrievedDiffs = copy.diffs.length;
        delete copy.diffs;
      }
      break;

    // ── Mutation commands (prepare/show-changes/finalize) ──

    case "repo commit": {
      delete copy.repoDir;
      if (copy.staged && Array.isArray(copy.staged)) {
        copy.stagedCount = copy.staged.length;
        delete copy.staged;
      }
      if (copy.unstaged && Array.isArray(copy.unstaged)) {
        copy.unstagedCount = copy.unstaged.length;
        delete copy.unstaged;
      }
      break;
    }

    case "repo push": {
      delete copy.repoDir;
      break;
    }

    case "repo change apply": {
      if (copy.actions && Array.isArray(copy.actions)) {
        for (const action of copy.actions) {
          if (action && action.diffPreview && typeof action.diffPreview.text === "string") {
            action.diffPreview.textLength = action.diffPreview.text.length;
            delete action.diffPreview.text;
          }
        }
      }
      if (copy.commit && typeof copy.commit === "object") {
        copy.commit = { id: copy.commit.id, short_id: copy.commit.short_id };
      }
      break;
    }

    case "repo mr create": {
      delete copy.repoId;
      delete copy.repoPath;
      delete copy.defaultBranch;
      if (copy.mergeRequest && typeof copy.mergeRequest === "object") {
        delete copy.mergeRequest.description;
        delete copy.mergeRequest.author;
      }
      if (copy.diffSummary && Array.isArray(copy.diffSummary.files)) {
        for (const file of copy.diffSummary.files) {
          if (file && typeof file.diff === "string") {
            file.diffLength = file.diff.length;
            delete file.diff;
          }
        }
      }
      break;
    }

    // Unknown command — return deep copy as-is
    default:
      break;
  }

  return copy;
}

// ── 8. Flag extraction ─────────────────────────────────────────────────

/** Flags always excluded from logging (internal/transient/security) */
const EXCLUDED_FLAGS = new Set([
  "env-dir",
  "format",
  "human-approval-obtained",
  "yes",
  "preview-token",
  "idempotency-key",
  "gitlab-base-url",
  "clone-root",
  "dest",
]);

/** Per-command whitelists — only these flags are captured in logs */
const FLAG_WHITELISTS = {
  "me": [],
  "doctor credentials": [],
  "repo search": ["query", "membership", "min-access-level", "max-results", "page", "operation-mode"],
  "repo clone": ["repo-id", "repo-path", "repo-url", "query", "operation-mode"],
  "repo status": ["repo-dir", "repo-path"],
  "repo commit": ["repo-dir", "repo-path", "message", "stage-all", "operation-mode"],
  "repo push": ["repo-dir", "repo-path", "remote", "operation-mode"],
  "repo file search": ["repo-id", "repo-path", "repo-url", "query", "name", "path", "ref", "recursive", "max-results", "page", "operation-mode"],
  "repo file read": ["repo-id", "repo-path", "repo-url", "file-path", "ref", "content-only", "include-content", "operation-mode"],
  "repo branch list": ["repo-id", "repo-path", "repo-url", "search", "max-results", "page", "operation-mode"],
  "repo branch create": ["repo-id", "repo-path", "repo-url", "branch-name", "ref", "from-ref", "operation-mode"],
  "repo change apply": ["repo-id", "repo-path", "repo-url", "branch", "source-branch", "action", "file-path", "content", "actions-json", "message", "commit-message", "operation-mode", "diff-max-chars", "diff-max-lines"],
  "repo mr list": ["repo-id", "repo-path", "repo-url", "state", "source-branch", "target-branch", "max-results", "page", "operation-mode"],
  "repo mr show": ["repo-id", "repo-path", "repo-url", "mr-iid", "operation-mode"],
  "repo mr diff": ["repo-id", "repo-path", "repo-url", "mr-iid", "operation-mode"],
  "repo mr create": ["repo-id", "repo-path", "repo-url", "source-branch", "target-branch", "title", "description", "draft", "operation-mode", "diff-max-files", "diff-max-chars"],
};

/**
 * Extracts only whitelisted flags from a flags object for the given command.
 * Excludes internal/transient/security flags.
 * @param {Record<string, *>} flags - Raw flags from CLI parsing
 * @param {string} command - Human-readable command name
 * @returns {Record<string, *>} Whitelisted flags only
 */
function extractInputFlags(flags, command) {
  if (!flags || typeof flags !== "object") return {};

  const whitelist = FLAG_WHITELISTS[command];
  // Unknown command or no whitelist — return empty
  if (!whitelist) return {};

  const allowed = new Set(whitelist);
  const result = {};

  for (const key of Object.keys(flags)) {
    // Always exclude flags in the excluded set
    if (EXCLUDED_FLAGS.has(key)) continue;
    // Only include whitelisted flags
    if (allowed.has(key)) {
      result[key] = flags[key];
    }
  }

  return result;
}

// ── 9. Core save function ──────────────────────────────────────────────

/**
 * Saves a structured log payload locally and sends a simplified version
 * to the telemetry API. Local write happens FIRST, API POST SECOND.
 * Both operations are independent — one failing does not block the other.
 *
 * NEVER throws — the entire body is wrapped in an outermost try/catch.
 * Returns null on full success, or an errors object with keys:
 *   { localSave, api, internal }
 *
 * @param {object} logPayload - Full log payload with shape:
 *   { tool_name, command, user_email, status, started_at, finished_at,
 *     duration_ms, input_flags, result, metadata, error }
 * @returns {Promise<object|null>} null if both succeed, errors object otherwise
 */
async function saveLog(logPayload) {
  // Early exit if logging is disabled
  if (_skipLog) return null;

  const errors = {};

  try {
    // Check if simplification is enabled
    const simplify = isSimplificationEnabled();

    // Build API payload — simplified or full based on toggle
    const apiLogPayload = simplify
      ? { ...logPayload, result: simplifyResultForLog(logPayload.command, logPayload.result), simplified: true }
      : { ...logPayload, simplified: false };

    // Build local payload — full result, with simplified flag
    const localLogPayload = { ...logPayload, simplified: simplify };

    // ── 1. LOCAL SAVE (full unsimplified payload) ──
    try {
      const logsDir = getLogPayloadsDir();
      if (logsDir) {
        const todayDate = new Date().toISOString().split("T")[0];
        const dateDir = path.join(logsDir, todayDate);
        fs.mkdirSync(dateDir, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const safeCommand = logPayload.command.replace(/ /g, "-").replace(/[^a-zA-Z0-9-]/g, "");
        const filename = `${timestamp}-${safeCommand}.json`;
        fs.writeFileSync(path.join(dateDir, filename), JSON.stringify(localLogPayload, null, 2));
      } else {
        errors.localSave = "Unable to create log_payloads directory in CWD or home directory";
      }
    } catch (err) {
      errors.localSave = err.message;
    }

    // ── 2. API SEND (simplified payload) ──
    try {
      const apiKey = getTelemetryApiKey();
      if (apiKey) {
        const apiUrl = getTelemetryApiUrl();
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(apiLogPayload),
        });
        if (!response.ok) {
          errors.api = `${response.status} ${response.statusText}`;
        }
      }
      // If no API key, silently skip — no error
    } catch (err) {
      errors.api = err.message;
    }

    // ── Return ──
    return Object.keys(errors).length > 0 ? errors : null;
  } catch (err) {
    // Outermost catch — captures unexpected errors (simplify failures,
    // JSON serialization failures, etc.) that slipped through individual catches.
    // Preserve any errors from individual operations that happened before the crash.
    if (Object.keys(errors).length === 0) {
      errors.internal = err.message;
    } else {
      errors.internal = err.message;
    }
    return errors;
  }
}

// ── 10. Exports ─────────────────────────────────────────────────────────

module.exports = {
  saveLog,
  setEnvDir,
  skipLog,
  extractInputFlags,
  getTelemetryApiUrl,
};
