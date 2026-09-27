const fs = require("fs");
const path = require("path");
const { CliError } = require("./utils/errors");
const { ensureDirectory } = require("./utils/pathGuards");
const { resolveEnvFilePath, resolveStateDir } = require("./utils/runtimePaths");

const REQUIRED = ["GITLAB_USERNAME", "GITLAB_TOKEN"];

function stripQuotes(value) {
  if (typeof value !== "string") return value;
  if (value.length >= 2) {
    const a = value[0];
    const b = value[value.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function parseDotEnv(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const out = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const valueLine = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const eq = valueLine.indexOf("=");
    if (eq < 1) continue;
    const key = valueLine.slice(0, eq).trim();
    const value = stripQuotes(valueLine.slice(eq + 1).trim());
    out[key] = value;
  }

  return out;
}

function normalizeCredentials(source, sourceName) {
  const mapped = {
    GITLAB_USERNAME: source.GITLAB_USERNAME,
    GITLAB_TOKEN: source.GITLAB_TOKEN,
    GITLAB_CA_BUNDLE: source.GITLAB_CA_BUNDLE || source.GITLAB_CA_BUNDLE_PATH,
    GITLAB_CA_CERT_PEM: source.GITLAB_CA_CERT_PEM || source.GITLAB_CA_PEM,
  };

  const missing = REQUIRED.filter((k) => !mapped[k]);
  if (missing.length > 0) {
    throw new CliError(`Missing ${missing.join(", ")} in ${sourceName}.`, 2, {
      code: "MISSING_CREDENTIALS",
      category: "credentials",
      remediation: `Populate ${missing.join(", ")} and retry.`,
      source: sourceName,
      missing,
    });
  }

  return mapped;
}

function decodeEscapedNewlines(value) {
  return String(value || "").replace(/\\n/g, "\n");
}

function decodeMaybeBase64(value) {
  try {
    const raw = Buffer.from(String(value || ""), "base64").toString("utf8");
    if (raw.includes("BEGIN CERTIFICATE")) return raw;
    return null;
  } catch (_) {
    return null;
  }
}

function inferCaInputType(value) {
  const raw = String(value || "").trim();
  if (!raw) return "none";
  if (fs.existsSync(raw)) return "path";
  const newlineDecoded = decodeEscapedNewlines(raw);
  if (newlineDecoded.includes("BEGIN CERTIFICATE")) return "pem";
  if (decodeMaybeBase64(raw)) return "base64-pem";
  return "unknown";
}

function hasRequiredCredentials(source = {}) {
  return Boolean(source.GITLAB_USERNAME && source.GITLAB_TOKEN);
}

function materializeCaFile(caValue, invocationCwd) {
  if (!caValue) return null;
  const raw = String(caValue).trim();
  if (!raw) return null;

  if (fs.existsSync(raw)) {
    return path.resolve(raw);
  }

  let pem = decodeEscapedNewlines(raw);
  if (!pem.includes("BEGIN CERTIFICATE")) {
    const decoded = decodeMaybeBase64(raw);
    if (decoded) pem = decoded;
  }

  if (!pem.includes("BEGIN CERTIFICATE")) {
    throw new CliError("Invalid GitLab CA input. Expected a file path, PEM, or base64-encoded PEM.", 2, {
      code: "INVALID_CA_BUNDLE_INPUT",
      category: "credentials",
      remediation:
        "Set GITLAB_CA_BUNDLE to an existing PEM file path, PEM content, or base64-encoded PEM.",
    });
  }

  const certDir = path.join(resolveStateDir(invocationCwd), "certs");
  const certPath = path.join(certDir, "gitlab-ca.pem");
  ensureDirectory(certDir);
  fs.writeFileSync(certPath, pem.endsWith("\n") ? pem : `${pem}\n`, "utf8");
  return certPath;
}

function resolveGitTlsEnv(credentials, invocationCwd = process.cwd()) {
  const caInput = credentials?.GITLAB_CA_BUNDLE || credentials?.GITLAB_CA_CERT_PEM;
  if (!caInput) return {};
  const caFile = materializeCaFile(caInput, invocationCwd);
  if (caFile) {
    process.env.NODE_EXTRA_CA_CERTS = caFile;
    return { GIT_SSL_CAINFO: caFile };
  }
  return {};
}

function readDotEnvMaybe(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return parseDotEnv(filePath);
}

function loadCredentials(flags = {}, invocationCwd = process.cwd()) {
  const attempts = [];
  const envPath = resolveEnvFilePath(flags);
  const envDirPath = flags["env-dir"] ? path.resolve(flags["env-dir"], ".env") : null;
  const envFromPath = readDotEnvMaybe(envPath);
  const envFromDir = readDotEnvMaybe(envDirPath);
  const merged = Object.assign({}, envFromPath || {}, envFromDir || {}, process.env);

  try {
    const normalized = normalizeCredentials(merged, envPath ? `process.env + dotenv:${envPath}` : "process.env");
    const source = hasRequiredCredentials(process.env)
      ? "env"
      : envFromPath && hasRequiredCredentials(envFromPath)
        ? "dotenv"
        : envFromDir && hasRequiredCredentials(envFromDir)
          ? "dotenv"
          : envPath || envDirPath
            ? "env+dotenv"
            : "env";
    return {
      ...normalized,
      source,
      envPath: envPath || null,
    };
  } catch (err) {
    attempts.push({ source: "env", error: err.message });

    if (envPath) {
      attempts.push({
        source: "dotenv-path",
        path: envPath,
        exists: Boolean(envFromPath),
        error: envFromPath ? err.message : `No .env found at ${envPath}.`,
      });
    }

    if (envDirPath) {
      attempts.push({
        source: "dotenv-dir",
        path: envDirPath,
        exists: Boolean(envFromDir),
        error: envFromDir ? err.message : `No .env found at ${envDirPath}.`,
      });
    }

    throw new CliError("Unable to resolve GitLab credentials from process env or .env sources.", 2, {
      code: "CREDENTIAL_RESOLUTION_FAILED",
      category: "credentials",
      remediation:
        "Set GITLAB_USERNAME and GITLAB_TOKEN in the environment, pass --env-dir, or set GITLAB_ENV_PATH to a .env file.",
      attempts,
    });
  }
}

function inspectCredentialSources(flags = {}, invocationCwd = process.cwd()) {
  const envPath = resolveEnvFilePath(flags);
  const envDirPath = flags["env-dir"] ? path.resolve(flags["env-dir"], ".env") : null;
  const parsedEnvPath = readDotEnvMaybe(envPath);
  const parsedEnvDir = readDotEnvMaybe(envDirPath);

  const checks = [];

  function hasCaInput(source = {}) {
    return Boolean(source.GITLAB_CA_BUNDLE || source.GITLAB_CA_BUNDLE_PATH || source.GITLAB_CA_CERT_PEM || source.GITLAB_CA_PEM);
  }

  checks.push({
    source: "env",
    hasUsername: Boolean(process.env.GITLAB_USERNAME),
    hasToken: Boolean(process.env.GITLAB_TOKEN),
    hasCaInput: hasCaInput(process.env),
  });

  checks.push({
    source: "dotenv-path",
    path: envPath,
    exists: Boolean(parsedEnvPath),
    hasUsername: Boolean(parsedEnvPath?.GITLAB_USERNAME),
    hasToken: Boolean(parsedEnvPath?.GITLAB_TOKEN),
    hasCaInput: hasCaInput(parsedEnvPath || {}),
  });

  checks.push({
    source: "dotenv-dir",
    path: envDirPath,
    exists: Boolean(parsedEnvDir),
    hasUsername: Boolean(parsedEnvDir?.GITLAB_USERNAME),
    hasToken: Boolean(parsedEnvDir?.GITLAB_TOKEN),
    hasCaInput: hasCaInput(parsedEnvDir || {}),
  });

  let selectedSource = "none";
  let tls = {
    caConfigured: false,
    caInputType: "none",
  };
  try {
    const selected = loadCredentials(flags, invocationCwd);
    selectedSource = selected.source;
    const caRaw = selected.GITLAB_CA_BUNDLE || selected.GITLAB_CA_CERT_PEM;
    tls = {
      caConfigured: Boolean(caRaw),
      caInputType: inferCaInputType(caRaw),
    };
  } catch (_) {
    selectedSource = "none";
  }

  return {
    mode: "doctor-credentials",
    selectedSource,
    tls,
    checks,
    envPath: envPath || null,
    envDir: flags["env-dir"] || null,
  };
}

// ── Email caching (resolved once per invocation from /api/v4/user) ──────

let _userEmail = null;

/**
 * Stores the authenticated user's email for use in log payloads.
 * Called once per CLI invocation after credentials are validated.
 * @param {string} email
 */
function setUserEmail(email) {
  if (email && typeof email === "string") {
    _userEmail = email;
  }
}

/**
 * Returns the cached user email, or falls back to GITLAB_USERNAME env var.
 * @returns {string}
 */
function getUserEmail() {
  return _userEmail || process.env.GITLAB_USERNAME || "unknown";
}

module.exports = {
  loadCredentials,
  inspectCredentialSources,
  resolveGitTlsEnv,
  setUserEmail,
  getUserEmail,
};
