const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { CliError } = require("./utils/errors");

const PIPE_FILE_NAME = ".gitlab-pipe.json";
const WARNING_EMITTED = new Set();
const DEFAULT_RETRIES = 3;

// ── Pipe path resolution ──────────────────────────────────────────────

function getPipeCandidates() {
  return [
    path.join(process.cwd(), PIPE_FILE_NAME),
    path.join(os.homedir(), PIPE_FILE_NAME),
  ];
}

function findExistingPipePath() {
  for (const filePath of getPipeCandidates()) {
    try {
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function findWritablePipePath() {
  for (const filePath of getPipeCandidates()) {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const testPath = path.join(dir, `.${Date.now()}.tmp`);
      fs.writeFileSync(testPath, "");
      fs.unlinkSync(testPath);
      return filePath;
    } catch {
      continue;
    }
  }
  return null;
}

function resolvePipePath() {
  const existing = findExistingPipePath();
  if (existing) return existing;
  return findWritablePipePath();
}

// ── Pipe file I/O ─────────────────────────────────────────────────────

function readPipe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writePipe(filePath, data) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  } catch {
    // silently fail
  }
}

function deletePipe(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // silently fail
  }
}

// ── Flag normalization ────────────────────────────────────────────────

function normalizeFlagsForComparison(flags) {
  const exclude = new Set([
    "operation-mode",
    "human-approval-obtained",
    "yes",
    "preview-token",
    "idempotency-key",
    "env-dir",
    "format",
    "gitlab-base-url",
    "clone-root",
  ]);
  const result = {};
  for (const [key, value] of Object.entries(flags)) {
    if (!exclude.has(key)) {
      result[key] = value;
    }
  }
  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────

function generateWorkflowId() {
  return crypto.randomUUID();
}

function warnOnce(message) {
  if (!WARNING_EMITTED.has(message)) {
    WARNING_EMITTED.add(message);
    console.error(message);
  }
}

// ── Public API ────────────────────────────────────────────────────────

function createWorkflow(args, commandName) {
  const pipePath = resolvePipePath();
  if (!pipePath) {
    warnOnce(
      "Warning: Unable to create .gitlab-pipe.json in current directory or home directory. " +
        "Please cd to a directory with write permissions to use mutative commands with workflow tracking."
    );
    return null;
  }

  const currentFlags = normalizeFlagsForComparison(args);
  const existingPipe = readPipe(pipePath);

  if (existingPipe && existingPipe.commandName && existingPipe.commandName !== commandName) {
    console.error(
      `Warning: clearing existing workflow for '${existingPipe.commandName}' to start '${commandName}'.`
    );
    clearPipe();
  }

  const refreshedPipe = readPipe(pipePath);
  if (refreshedPipe && refreshedPipe.commandName === commandName) {
    if (JSON.stringify(refreshedPipe.flags) !== JSON.stringify(currentFlags)) {
      console.error(
        "Warning: workflow flags changed. Restarting workflow from prepare with current flags."
      );
      clearPipe();
    }
  }

  const pipeAfterClear = readPipe(pipePath);
  const workflowId = pipeAfterClear?.workflowId || generateWorkflowId();
  const newPipe = {
    commandName,
    flags: currentFlags,
    workflowId,
    stages: ["prepare"],
    retriesRemaining: DEFAULT_RETRIES,
    createdAt: pipeAfterClear?.createdAt || new Date().toISOString(),
  };

  writePipe(pipePath, newPipe);
  return workflowId;
}

function validateStage(args, commandName, requiredStages) {
  const pipePath = resolvePipePath();
  if (!pipePath) {
    throw new CliError(
      "No active workflow found. Run --operation-mode prepare first.",
      3
    );
  }

  const pipe = readPipe(pipePath);
  if (!pipe || !pipe.commandName) {
    throw new CliError(
      "No active workflow found. Run --operation-mode prepare first.",
      3
    );
  }

  if (pipe.commandName !== commandName) {
    throw new CliError(
      `Workflow mismatch: found pipe for '${pipe.commandName}' but running '${commandName}'. ` +
        "Clear .gitlab-pipe.json or complete the existing workflow.",
      3
    );
  }

  const currentFlags = normalizeFlagsForComparison(args);
  if (JSON.stringify(pipe.flags) !== JSON.stringify(currentFlags)) {
    throw new CliError(
      "Workflow flags changed. Restart from --operation-mode prepare with current flags.",
      3
    );
  }

  for (const stage of requiredStages) {
    if (!pipe.stages.includes(stage)) {
      const missing = requiredStages.filter((s) => !pipe.stages.includes(s));
      throw new CliError(
        `Workflow incomplete: need [${missing.join(", ")}] before this stage. ` +
          `Run --operation-mode ${missing[0]} first.`,
        3
      );
    }
  }

  return pipe.workflowId;
}

function recordStage(stage) {
  const pipePath = resolvePipePath();
  if (!pipePath) return;
  const pipe = readPipe(pipePath);
  if (!pipe) return;
  const stages = Array.from(new Set([...pipe.stages, stage]));
  writePipe(pipePath, { ...pipe, stages });
}

function recordSuccess() {
  const pipePath = resolvePipePath();
  if (pipePath) {
    deletePipe(pipePath);
  }
}

function recordFailure() {
  const pipePath = resolvePipePath();
  if (!pipePath) return { shouldRetry: false, retriesRemaining: 0 };

  const pipe = readPipe(pipePath);
  if (!pipe) return { shouldRetry: false, retriesRemaining: 0 };

  const remaining = (pipe.retriesRemaining || DEFAULT_RETRIES) - 1;
  if (remaining <= 0) {
    deletePipe(pipePath);
    return { shouldRetry: false, retriesRemaining: 0 };
  }

  pipe.retriesRemaining = remaining;
  writePipe(pipePath, pipe);
  return { shouldRetry: true, retriesRemaining: remaining };
}

function getPipeState() {
  const pipePath = resolvePipePath();
  if (!pipePath) return null;
  return readPipe(pipePath);
}

function clearPipe() {
  const pipePath = resolvePipePath();
  if (pipePath) {
    deletePipe(pipePath);
  }
}

function getPipePath() {
  return resolvePipePath();
}

module.exports = {
  createWorkflow,
  validateStage,
  recordStage,
  recordSuccess,
  recordFailure,
  getPipeState,
  clearPipe,
  getPipePath,
};
