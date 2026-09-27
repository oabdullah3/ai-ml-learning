const { requireFlag } = require("../utils/flagValidator");
const { CliError } = require("../utils/errors");
const { requireResolvedRepo } = require("./repoResolve");
const { createWorkflow, validateStage, recordStage, recordSuccess, recordFailure, getPipeState } = require("../workflowIdManager");
const { saveLog, extractInputFlags } = require("../log");
const { getUserEmail } = require("../config");

async function repoBranchListCommand(client, flags, output) {
  const startedAt = new Date();
  let finalResult = null;
  let status = "success";
  let errorMessage = null;

  try {
    const repo = await requireResolvedRepo(client, flags, output, "repo branch list", "list");
    if (!repo) return;

    const branches = await client.listBranches({
      projectId: repo.id,
      search: flags.search,
      perPage: flags["max-results"] || 20,
      page: flags.page || 1,
    });

    finalResult = {
      mode: "success",
      command: "repo branch list",
      operationMode: "list",
      result: {
        repo: {
          id: repo.id,
          path_with_namespace: repo.path_with_namespace,
        },
        count: branches.length,
        branches: branches.map((b) => ({
          name: b.name,
          merged: Boolean(b.merged),
          protected: Boolean(b.protected),
          default: Boolean(b.default),
          can_push: Boolean(b.can_push),
          web_url: b.web_url,
        })),
      },
      metadata: {
        gitlabBaseUrl: client.baseUrl,
        search: flags.search || "",
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
      command: "repo branch list",
      user_email: getUserEmail(),
      status,
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: new Date().getTime() - startedAt.getTime(),
      input_flags: extractInputFlags(flags, "repo branch list"),
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

async function repoBranchCreateCommand(client, flags, output, context) {
  const startedAt = new Date();
  let finalResult = null;
  let status = "success";
  let errorMessage = null;
  let workflowId = null;
  let operationMode = null;

  try {
    operationMode = flags["operation-mode"] || "prepare";
    requireFlag(flags, "branch-name", "Missing --branch-name for repo branch create.");

    const repo = await requireResolvedRepo(client, flags, output, "repo branch create", operationMode);
    if (!repo) return;

    const fromRef = flags.ref || flags["from-ref"] || repo.default_branch || "main";
    const payload = {
      repoId: repo.id,
      repoPath: repo.path_with_namespace,
      branchName: flags["branch-name"],
      fromRef,
    };

    if (operationMode === "prepare") {
      workflowId = createWorkflow(flags, "repo branch create");
      finalResult = {
        mode: "success",
        command: "repo branch create",
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
      workflowId = validateStage(flags, "repo branch create", ["prepare"]);
      recordStage("show-changes");
      const pipeState = getPipeState();

      finalResult = {
        mode: "success",
        command: "repo branch create",
        operationMode: "show-changes",
        result: {
          planSummary: payload,
          workflowId: pipeState ? pipeState.workflowId : null,
        },
        metadata: {
          gitlabBaseUrl: client.baseUrl,
        },
        warnings: ["Branch create uses 2-step flow; show-changes is treated as prepare."],
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

      workflowId = validateStage(flags, "repo branch create", ["prepare", "show-changes"]);

      const created = await client.createBranch({
        projectId: repo.id,
        branch: flags["branch-name"],
        ref: fromRef,
      });

      recordStage("finalize");
      recordSuccess();

      finalResult = {
        mode: "success",
        command: "repo branch create",
        operationMode,
        result: {
          created: true,
          repo: {
            id: repo.id,
            path_with_namespace: repo.path_with_namespace,
          },
          branch: {
            name: created.name,
            default: Boolean(created.default),
            protected: Boolean(created.protected),
            can_push: Boolean(created.can_push),
            web_url: created.web_url,
          },
        },
        metadata: {
          gitlabBaseUrl: client.baseUrl,
        },
        warnings: [],
        nextSteps: ["Use repo mr create to open a merge request from this branch."],
      };
      return;
    }

    throw new CliError(`Unsupported operation mode '${operationMode}' for repo branch create.`, 2, {
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
      command: "repo branch create",
      user_email: getUserEmail(),
      status,
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: new Date().getTime() - startedAt.getTime(),
      input_flags: extractInputFlags(flags, "repo branch create"),
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
  repoBranchListCommand,
  repoBranchCreateCommand,
};