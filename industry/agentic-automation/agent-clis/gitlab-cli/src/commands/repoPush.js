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

function collectPushState(repoDir) {
  const branchLine = runGit(["status", "--porcelain", "--branch"], repoDir).stdout
    .split(/\r?\n/)
    .find((l) => l.startsWith("##"));

  const branch = (branchLine || "").replace(/^##\s*/, "").trim();
  const aheadMatch = branch.match(/ahead\s+(\d+)/i);
  const behindMatch = branch.match(/behind\s+(\d+)/i);

  let upstream = null;
  const upstreamResult = runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], repoDir, {
    allowFailure: true,
  });
  if (upstreamResult.status === 0) {
    upstream = upstreamResult.stdout.trim();
  } else {
    // @{u} failed — fall back to git config.  Branches checked out
    // via raw refspec fetches (e.g. +refs/heads/*:refs/remotes/origin/*)
    // don't register upstream tracking, so @{u} fails even though
    // origin/BRANCH exists.  git config branch.<BRANCH>.{remote,merge}
    // may still be set.
    const remoteResult = runGit(["config", "--get", `branch.${branch}.remote`], repoDir, { allowFailure: true });
    const mergeResult = runGit(["config", "--get", `branch.${branch}.merge`], repoDir, { allowFailure: true });
    if (remoteResult.status === 0 && mergeResult.status === 0) {
      const remote = remoteResult.stdout.trim();
      const mergeShort = mergeResult.stdout.trim().replace(/^refs\/heads\//, "");
      upstream = `${remote}/${mergeShort}`;
    }
  }

  return {
    branch,
    upstream,
    ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
    behind: behindMatch ? Number(behindMatch[1]) : 0,
  };
}

async function repoPushCommand(flags, output, context) {
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
    const state = collectPushState(resolved.repoDir);

    const payload = {
      branch: state.branch,
      upstream: state.upstream,
      ahead: state.ahead,
      behind: state.behind,
      remote: flags.remote || "origin",
    };

    if (operationMode === "prepare") {
      workflowId = createWorkflow(flags, "repo push");
      finalResult = {
        mode: "success",
        command: "repo push",
        operationMode,
        result: {
          repoDir: resolved.repoDir,
          planSummary: payload,
          workflowId,
        },
        metadata: { gitlabBaseUrl: context.runtimeBaseUrl },
        warnings: state.upstream ? [] : ["No upstream branch is configured."],
        nextSteps: ["Run with --operation-mode show-changes."],
      };
      return;
    }

    if (operationMode === "show-changes") {
      workflowId = validateStage(flags, "repo push", ["prepare"]);
      recordStage("show-changes");
      const pipeState = getPipeState();

      finalResult = {
        mode: "success",
        command: "repo push",
        operationMode,
        result: {
          repoDir: resolved.repoDir,
          changeSummary: payload,
          workflowId: pipeState ? pipeState.workflowId : null,
        },
        metadata: { gitlabBaseUrl: context.runtimeBaseUrl },
        warnings: state.behind > 0 ? ["Local branch is behind upstream; push may fail until pulled/rebased."] : [],
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

      workflowId = validateStage(flags, "repo push", ["prepare", "show-changes"]);

      if (!state.upstream) {
        throw new CliError("Cannot push without upstream tracking branch.", 2, {
          code: "MISSING_UPSTREAM",
          category: "validation",
          remediation: `Set upstream with: git branch --set-upstream-to=origin/${state.branch} ${state.branch}`,
        });
      }

      if (state.behind > 0) {
        throw new CliError("Push blocked: local branch is behind upstream.", 2, {
          code: "PUSH_BLOCKED_BEHIND_UPSTREAM",
          category: "safety",
          remediation: "Pull/rebase and rerun staged push workflow.",
        });
      }

      runGit(["push", flags.remote || "origin"], resolved.repoDir, {
        env: context.gitEnv || {},
      });
      const after = collectPushState(resolved.repoDir);

      recordStage("finalize");
      recordSuccess();

      finalResult = {
        mode: "success",
        command: "repo push",
        operationMode,
        result: {
          pushed: true,
          repoDir: resolved.repoDir,
          postPushState: after,
        },
        metadata: { gitlabBaseUrl: context.runtimeBaseUrl },
        warnings: [],
        nextSteps: [],
      };
      return;
    }

    throw new CliError(`Unsupported operation mode '${operationMode}' for repo push.`, 2, {
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
      command: "repo push",
      user_email: getUserEmail(),
      status,
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: new Date().getTime() - startedAt.getTime(),
      input_flags: extractInputFlags(flags, "repo push"),
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
  repoPushCommand,
};
