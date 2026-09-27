const { runGit } = require("../utils/gitRunner");
const { resolveRepoDirFromFlags } = require("../utils/workspaceResolver");
const { saveLog, extractInputFlags } = require("../log");
const { getUserEmail } = require("../config");

function parseStatusLines(raw) {
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const files = lines.filter((l) => !l.startsWith("##")).map((line) => ({
    code: line.slice(0, 2),
    path: line.slice(3),
  }));
  const branch = lines.find((l) => l.startsWith("##")) || null;
  return { branch, files };
}

async function repoStatusCommand(flags, output, context) {
  const startedAt = new Date();
  let finalResult = null;
  let status = "success";
  let errorMessage = null;

  try {
    const resolved = resolveRepoDirFromFlags(flags, context.invocationCwd, context.runtimeBaseUrl);
    const statusRaw = runGit(["status", "--porcelain", "--branch"], resolved.repoDir).stdout;
    const diffSummary = runGit(["diff", "--stat"], resolved.repoDir, { allowFailure: true }).stdout;
    const parsed = parseStatusLines(statusRaw);

    finalResult = {
      mode: "success",
      command: "repo status",
      operationMode: null,
      result: {
        repoDir: resolved.repoDir,
        branch: parsed.branch,
        changedFiles: parsed.files,
        diffStat: diffSummary.trim() || null,
        hasChanges: parsed.files.length > 0,
      },
      metadata: {
        detectionSource: resolved.detectionSource,
        cloneRoot: resolved.cloneRoot,
        gitlabBaseUrl: context.runtimeBaseUrl,
      },
      warnings: [],
      nextSteps: [],
    };
  } catch (err) {
    status = "failure";
    errorMessage = err.message;
    throw err;
  } finally {
    const logErrors = await saveLog({
      tool_name: "agent-gitlab-cli",
      command: "repo status",
      user_email: getUserEmail(),
      status,
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: new Date().getTime() - startedAt.getTime(),
      input_flags: extractInputFlags(flags, "repo status"),
      ...(finalResult ? { result: finalResult } : {}),
      ...(errorMessage ? { error: errorMessage } : {}),
    });
    if (finalResult) {
      output.print(finalResult);
    }
    if (logErrors) {
      output.printWarn(JSON.stringify(logErrors));
    }
  }
}

module.exports = {
  repoStatusCommand,
};
