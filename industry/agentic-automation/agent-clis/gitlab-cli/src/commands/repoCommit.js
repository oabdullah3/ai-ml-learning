const { CliError } = require("../utils/errors");
const { runGit } = require("../utils/gitRunner");
const { resolveRepoDirFromFlags } = require("../utils/workspaceResolver");
const { createWorkflow, validateStage, recordStage, recordSuccess, recordFailure, getPipeState } = require("../workflowIdManager");
const { saveLog, extractInputFlags } = require("../log");
const { getUserEmail } = require("../config");

function currentBranchName(repoDir) {
  // symbolic-ref works in empty repos (no commits); rev-parse fails there
  const symbolic = runGit(["symbolic-ref", "--short", "HEAD"], repoDir, { allowFailure: true });
  if (symbolic.status === 0 && symbolic.stdout.trim()) {
    return symbolic.stdout.trim();
  }
  // Fallback for detached HEAD state
  return runGit(["rev-parse", "--abbrev-ref", "HEAD"], repoDir).stdout.trim();
}

function defaultBranchName(repoDir) {
  const result = runGit(["symbolic-ref", "refs/remotes/origin/HEAD"], repoDir, { allowFailure: true });
  if (result.status !== 0) return null;
  const ref = result.stdout.trim();
  const parts = ref.split("/");
  return parts[parts.length - 1] || null;
}

function guardDefaultBranchMutation(repoDir) {
  const current = currentBranchName(repoDir);
  const defaultBranch = defaultBranchName(repoDir);
  if (!defaultBranch || current !== defaultBranch) return;

  throw new CliError("Mutating the default branch is blocked by safety policy.", 2, {
    code: "DEFAULT_BRANCH_MUTATION_BLOCKED",
    category: "safety",
    remediation: "Create a new branch from default and open a merge request back to the default branch.",
    defaultBranch,
    branch: current,
  });
}

function collectCommitState(repoDir) {
  const status = runGit(["status", "--porcelain"], repoDir).stdout
    .split(/\r?\n/)
    .filter(Boolean);
  const staged = status.filter((l) => l[0] !== " " && l[0] !== "?");
  const unstaged = status.filter((l) => l[1] !== " " || l.startsWith("??"));
  return { status, staged, unstaged };
}

async function repoCommitCommand(flags, output, context) {
  const startedAt = new Date();
  let finalResult = null;
  let status = "success";
  let errorMessage = null;
  let workflowId = null;
  let operationMode = null;

  try {
    operationMode = flags["operation-mode"] || "prepare";
    const resolved = resolveRepoDirFromFlags(flags, context.invocationCwd, context.runtimeBaseUrl);
    guardDefaultBranchMutation(resolved.repoDir);

    if (!flags.message) {
      throw new CliError("Missing --message for repo commit.", 2, {
        code: "MISSING_COMMIT_MESSAGE",
        category: "validation",
        remediation: "Provide commit message with --message.",
      });
    }

    const state = collectCommitState(resolved.repoDir);
    const payload = {
      message: flags.message,
      stageAll: Boolean(flags["stage-all"]),
      stagedCount: state.staged.length,
      unstagedCount: state.unstaged.length,
    };

    if (operationMode === "prepare") {
      workflowId = createWorkflow(flags, "repo commit");
      finalResult = {
        mode: "success",
        command: "repo commit",
        operationMode,
        result: {
          repoDir: resolved.repoDir,
          planSummary: payload,
          workflowId,
        },
        metadata: { gitlabBaseUrl: context.runtimeBaseUrl },
        warnings: state.status.length === 0 ? ["No local changes detected."] : [],
        nextSteps: ["Run with --operation-mode show-changes."],
      };
      return;
    }

    if (operationMode === "show-changes") {
      workflowId = validateStage(flags, "repo commit", ["prepare"]);
      recordStage("show-changes");
      const pipeState = getPipeState();

      finalResult = {
        mode: "success",
        command: "repo commit",
        operationMode,
        result: {
          repoDir: resolved.repoDir,
          changeSummary: {
            message: flags.message,
            staged: state.staged,
            unstaged: state.unstaged,
          },
          workflowId: pipeState ? pipeState.workflowId : null,
        },
        metadata: { gitlabBaseUrl: context.runtimeBaseUrl },
        warnings: [],
        nextSteps: ["Request explicit human approval, then run finalize with --human-approval-obtained."],
      };
      return;
    }

    if (operationMode === "finalize") {
      if (!flags["human-approval-obtained"]) {
        throw new CliError("--human-approval-obtained flag is required for finalize.", 3, {
          code: "HUMAN_APPROVAL_REQUIRED",
          category: "approval",
          remediation: "Re-run with --human-approval-obtained.",
        });
      }

      workflowId = validateStage(flags, "repo commit", ["prepare", "show-changes"]);

      if (flags["stage-all"]) {
        runGit(["add", "-A"], resolved.repoDir);
      }

      const refreshed = collectCommitState(resolved.repoDir);
      if (refreshed.staged.length === 0) {
        throw new CliError("No staged changes to commit. Use --stage-all or stage files manually.", 2, {
          code: "NO_STAGED_CHANGES",
          category: "validation",
          remediation: "Stage changes and rerun finalize.",
        });
      }

      runGit(["commit", "-m", flags.message], resolved.repoDir);
      const head = runGit(["rev-parse", "HEAD"], resolved.repoDir).stdout.trim();

      recordStage("finalize");
      recordSuccess();

      finalResult = {
        mode: "success",
        command: "repo commit",
        operationMode,
        result: {
          committed: true,
          repoDir: resolved.repoDir,
          head,
        },
        metadata: { gitlabBaseUrl: context.runtimeBaseUrl },
        warnings: [],
        nextSteps: ["Run repo push workflow to publish this commit."],
      };
      return;
    }

    throw new CliError(`Unsupported operation mode '${operationMode}' for repo commit.`, 2, {
      code: "INVALID_OPERATION_MODE",
      category: "validation",
      remediation: "Use prepare, show-changes, or finalize.",
    });
  } catch (err) {
    status = "failure";
    errorMessage = err.message;
    recordFailure();
    throw err;
  } finally {
    const logErrors = await saveLog({
      tool_name: "agent-gitlab-cli",
      command: "repo commit",
      user_email: getUserEmail(),
      status,
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: new Date().getTime() - startedAt.getTime(),
      input_flags: extractInputFlags(flags, "repo commit"),
      metadata: { stage: operationMode, "workflow-id": workflowId },
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
  repoCommitCommand,
};
