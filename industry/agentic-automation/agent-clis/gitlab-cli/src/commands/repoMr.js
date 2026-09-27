const { requireFlag } = require("../utils/flagValidator");
const { CliError } = require("../utils/errors");
const { requireResolvedRepo } = require("./repoResolve");
const { createWorkflow, validateStage, recordStage, recordSuccess, recordFailure, getPipeState } = require("../workflowIdManager");
const { saveLog, extractInputFlags } = require("../log");
const { getUserEmail } = require("../config");

const DEFAULT_MR_DIFF_MAX_FILES = 30;
const DEFAULT_MR_DIFF_MAX_CHARS = 4000;

function limitText(text, maxChars) {
  const value = String(text || "");
  if (value.length <= maxChars) return { text: value, truncated: false };
  return {
    text: `${value.slice(0, maxChars)}\n...<truncated>`,
    truncated: true,
  };
}

async function buildMrChangeSummary(client, repo, payload, flags) {
  const compare = await client.compareBranches({
    projectId: repo.id,
    from: payload.targetBranch,
    to: payload.sourceBranch,
    straight: true,
  });

  const maxFiles = Number(flags["diff-max-files"] || DEFAULT_MR_DIFF_MAX_FILES);
  const maxChars = Number(flags["diff-max-chars"] || DEFAULT_MR_DIFF_MAX_CHARS);
  const diffs = Array.isArray(compare?.diffs) ? compare.diffs : [];

  return {
    commitsCount: Array.isArray(compare?.commits) ? compare.commits.length : 0,
    fileCount: diffs.length,
    files: diffs.slice(0, maxFiles).map((d) => {
      const capped = limitText(d.diff || "", maxChars);
      return {
        old_path: d.old_path,
        new_path: d.new_path,
        new_file: Boolean(d.new_file),
        deleted_file: Boolean(d.deleted_file),
        renamed_file: Boolean(d.renamed_file),
        too_large: Boolean(d.too_large),
        diff: capped.text,
        diffTruncated: capped.truncated,
      };
    }),
    filesTruncated: diffs.length > maxFiles,
    compareTimeout: Boolean(compare?.compare_timeout),
    compareSameRef: Boolean(compare?.compare_same_ref),
  };
}

function summarizeMr(mr) {
  return {
    iid: mr.iid,
    title: mr.title,
    state: mr.state,
    draft: Boolean(mr.draft),
    source_branch: mr.source_branch,
    target_branch: mr.target_branch,
    web_url: mr.web_url,
    created_at: mr.created_at,
    updated_at: mr.updated_at,
    merge_status: mr.merge_status,
    detailed_merge_status: mr.detailed_merge_status,
    has_conflicts: Boolean(mr.has_conflicts),
    author: mr.author
      ? {
          id: mr.author.id,
          username: mr.author.username,
          name: mr.author.name,
        }
      : null,
  };
}

async function repoMrListCommand(client, flags, output) {
  const startedAt = new Date();
  let finalResult = null;
  let status = "success";
  let errorMessage = null;

  try {
    const repo = await requireResolvedRepo(client, flags, output, "repo mr list", "list");
    if (!repo) return;

    const mrs = await client.listMergeRequests({
      projectId: repo.id,
      state: flags.state || "opened",
      sourceBranch: flags["source-branch"],
      targetBranch: flags["target-branch"],
      perPage: flags["max-results"] || 20,
      page: flags.page || 1,
    });

    finalResult = {
      mode: "success",
      command: "repo mr list",
      operationMode: "list",
      result: {
        repo: {
          id: repo.id,
          path_with_namespace: repo.path_with_namespace,
        },
        count: mrs.length,
        mergeRequests: mrs.map(summarizeMr),
      },
      metadata: {
        gitlabBaseUrl: client.baseUrl,
        state: flags.state || "opened",
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
      command: "repo mr list",
      user_email: getUserEmail(),
      status,
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: new Date().getTime() - startedAt.getTime(),
      input_flags: extractInputFlags(flags, "repo mr list"),
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

async function repoMrShowCommand(client, flags, output) {
  const startedAt = new Date();
  let finalResult = null;
  let status = "success";
  let errorMessage = null;

  try {
    requireFlag(flags, "mr-iid", "Missing --mr-iid for repo mr show.");
    const repo = await requireResolvedRepo(client, flags, output, "repo mr show", "read");
    if (!repo) return;

    const mr = await client.getMergeRequest({
      projectId: repo.id,
      iid: flags["mr-iid"],
    });

    finalResult = {
      mode: "success",
      command: "repo mr show",
      operationMode: "read",
      result: {
        repo: {
          id: repo.id,
          path_with_namespace: repo.path_with_namespace,
        },
        mergeRequest: summarizeMr(mr),
      },
      metadata: {
        gitlabBaseUrl: client.baseUrl,
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
      command: "repo mr show",
      user_email: getUserEmail(),
      status,
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: new Date().getTime() - startedAt.getTime(),
      input_flags: extractInputFlags(flags, "repo mr show"),
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

async function repoMrDiffCommand(client, flags, output) {
  const startedAt = new Date();
  let finalResult = null;
  let status = "success";
  let errorMessage = null;

  try {
    requireFlag(flags, "mr-iid", "Missing --mr-iid for repo mr diff.");
    const repo = await requireResolvedRepo(client, flags, output, "repo mr diff", "read");
    if (!repo) return;

    const diffs = await client.getMergeRequestDiffs({
      projectId: repo.id,
      iid: flags["mr-iid"],
    });

    finalResult = {
      mode: "success",
      command: "repo mr diff",
      operationMode: "read",
      result: {
        repo: {
          id: repo.id,
          path_with_namespace: repo.path_with_namespace,
        },
        count: Array.isArray(diffs) ? diffs.length : 0,
        diffs: (Array.isArray(diffs) ? diffs : []).map((d) => ({
          old_path: d.old_path,
          new_path: d.new_path,
          new_file: Boolean(d.new_file),
          deleted_file: Boolean(d.deleted_file),
          renamed_file: Boolean(d.renamed_file),
          too_large: Boolean(d.too_large),
          diff: d.diff,
        })),
      },
      metadata: {
        gitlabBaseUrl: client.baseUrl,
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
      command: "repo mr diff",
      user_email: getUserEmail(),
      status,
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: new Date().getTime() - startedAt.getTime(),
      input_flags: extractInputFlags(flags, "repo mr diff"),
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

async function repoMrCreateCommand(client, flags, output, context) {
  const startedAt = new Date();
  let finalResult = null;
  let status = "success";
  let errorMessage = null;
  let workflowId = null;
  let operationMode = null;

  try {
    operationMode = flags["operation-mode"] || "prepare";
    requireFlag(flags, "source-branch", "Missing --source-branch for repo mr create.");
    requireFlag(flags, "title", "Missing --title for repo mr create.");

    const repo = await requireResolvedRepo(client, flags, output, "repo mr create", operationMode);
    if (!repo) return;

    if (flags.approve || flags["approve-mr"] || flags["approval-action"]) {
      throw new CliError("Merge request approval actions are unsupported by this CLI.", 2, {
        code: "MR_APPROVAL_UNSUPPORTED",
        category: "policy",
        remediation: "Use your normal review/approval process in GitLab after MR creation.",
      });
    }

    const defaultBranch = repo.default_branch || "main";
    const sourceBranch = String(flags["source-branch"]);
    const targetBranch = String(flags["target-branch"] || defaultBranch);

    if (sourceBranch === defaultBranch) {
      throw new CliError("Source branch cannot be the default branch for MR creation.", 2, {
        code: "SOURCE_DEFAULT_BRANCH_BLOCKED",
        category: "safety",
        remediation: "Create a new feature branch from default, apply changes there, then open the MR into default.",
      });
    }

    if (targetBranch !== defaultBranch) {
      throw new CliError("Target branch must be the repository default branch for MR creation.", 2, {
        code: "TARGET_BRANCH_NOT_DEFAULT",
        category: "safety",
        remediation: `Use --target-branch ${defaultBranch} and open feature-branch changes into default.`,
        defaultBranch,
        targetBranch,
      });
    }

    const payload = {
      repoId: repo.id,
      repoPath: repo.path_with_namespace,
      sourceBranch,
      targetBranch,
      defaultBranch,
      title: flags.title,
      description: flags.description || "",
      draft: flags.draft !== undefined ? Boolean(flags.draft) : true,
    };

    if (operationMode === "prepare") {
      workflowId = createWorkflow(flags, "repo mr create");
      finalResult = {
        mode: "success",
        command: "repo mr create",
        operationMode,
        result: {
          planSummary: payload,
          workflowId,
        },
        metadata: {
          gitlabBaseUrl: client.baseUrl,
        },
        warnings: [],
        nextSteps: ["Run with --operation-mode show-changes."],
      };
      return;
    }

    if (operationMode === "show-changes") {
      workflowId = validateStage(flags, "repo mr create", ["prepare"]);
      const diffSummary = await buildMrChangeSummary(client, repo, payload, flags);
      recordStage("show-changes");
      const pipeState = getPipeState();

      finalResult = {
        mode: "success",
        command: "repo mr create",
        operationMode,
        result: {
          changeSummary: {
            ...payload,
            diffSummary,
          },
          workflowId: pipeState ? pipeState.workflowId : null,
        },
        metadata: {
          gitlabBaseUrl: client.baseUrl,
        },
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

      workflowId = validateStage(flags, "repo mr create", ["prepare", "show-changes"]);

      const mr = await client.createMergeRequest({
        projectId: repo.id,
        sourceBranch: payload.sourceBranch,
        targetBranch: payload.targetBranch,
        title: payload.title,
        description: payload.description,
        draft: payload.draft,
      });

      recordStage("finalize");
      recordSuccess();

      finalResult = {
        mode: "success",
        command: "repo mr create",
        operationMode,
        result: {
          created: true,
          repo: {
            id: repo.id,
            path_with_namespace: repo.path_with_namespace,
          },
          mergeRequest: summarizeMr(mr),
        },
        metadata: {
          gitlabBaseUrl: client.baseUrl,
        },
        warnings: [],
        nextSteps: ["Share the merge request with reviewers for approval and merge."],
      };
      return;
    }

    throw new CliError(`Unsupported operation mode '${operationMode}' for repo mr create.`, 2, {
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
      command: "repo mr create",
      user_email: getUserEmail(),
      status,
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: new Date().getTime() - startedAt.getTime(),
      input_flags: extractInputFlags(flags, "repo mr create"),
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
  repoMrListCommand,
  repoMrShowCommand,
  repoMrDiffCommand,
  repoMrCreateCommand,
};