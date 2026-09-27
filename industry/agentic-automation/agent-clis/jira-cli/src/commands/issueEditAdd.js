const { CliError } = require("../errors");
const {
  buildActionPlan,
  executeActionPlan,
  summarizeActionPlan,
  mapActionsToPermissionRequirements,
} = require("../utils/issueActions");
const {
  assertRequiredFlag,
  assertForbiddenFlags,
  assertRequiredWith,
} = require("../utils/flagValidator");
const {
  buildPlanHash,
  buildPlanId,
  buildDiffSummary,
  requireNoDryRun,
} = require("../utils/mutationWorkflow");
const {
  buildPreflightIntent,
  runPermissionPreflight,
} = require("../utils/permissionPreflight");
const { saveLog, extractInputFlags } = require("../log");
const {
  createWorkflow,
  validateStage,
  recordStage,
  recordSuccess,
  recordFailure,
} = require("../utils/workflowIdManager");

const ADD_APPROVAL_INSTRUCTION =
  "YOU ARE REQUIRED TO SHARE THESE ADD-ONLY ACTIONS WITH YOUR HUMAN AND ASK THEM IF THEY AGREE WITH THE UPDATES ABOUT TO BE MADE. IF THE HUMAN AGREES, RERUN THE EXACT SAME COMMAND WITH THE --HUMAN-APPROVAL-OBTAINED FLAG APPENDED OTHERWISE DON'T RERUN IT.";

const FORBIDDEN_ADD_FLAGS = [
  "summary",
  "description",
  "start-date",
  "due-date",
  "priority-id",
  "component-ids",
  "parent-key",
  "parent-id",
  "environment-value",
  "environment-field-id",
  "story-points",
  "story-points-field-id",
  "original-estimate",
  "acceptance-value",
  "acceptance-field-id",
  "assignee-id",
  "transition-id",
  "labels-add",
  "labels-remove"
];

const MUTATING_ADD_KINDS = new Set(["comment", "worklog", "attachment", "labels", "link"]);

async function issueEditAddCommand(client, args, output) {
  const startedAt = new Date();
  const userEmail = client?.email || "unknown";
  const inputFlags = extractInputFlags(args, "issue edit add");

  let status = "success";
  let result = {};
  let error = null;
  let workflowId = null;

  const operationMode = String(args["operation-mode"] || "show-changes").toLowerCase();
  const issueIdOrKey = args.issue;
  const approvalObtained = Boolean(args["human-approval-obtained"] || args.yes);

  requireNoDryRun(args, "issue edit add");

  try {
    if (!["prepare", "show-changes", "finalize"].includes(operationMode)) {
      throw new CliError("Invalid --operation-mode for issue edit add. Allowed: prepare, show-changes, finalize", 3);
    }

    assertRequiredFlag(args, "issue", "issue edit add");

    assertForbiddenFlags(args, FORBIDDEN_ADD_FLAGS, "issue edit add");
    assertRequiredWith(args, "link-type", ["link-issue"], "issue edit add");
    assertRequiredWith(args, "link-issue", ["link-type"], "issue edit add");

    const actions = buildActionPlan(issueIdOrKey, args);
    if (actions.length === 0) {
      throw new CliError(
        "No add operation supplied. Use --comment-body, --worklog-time-spent, --attach-file, and/or --get-details",
        3
      );
    }

    const hasMutation = actions.some((action) => MUTATING_ADD_KINDS.has(action.kind));
    const plannedActions = summarizeActionPlan(actions);
    const warnings = buildAddWarnings(actions);
    const destructiveMarkers = [];
    const actor = String(client?.email || "unknown-actor");
    const targetKey = String(issueIdOrKey);
    const planHash = buildPlanHash({
      command: "issue-edit-add",
      issue: targetKey,
      plannedActions,
    });
    const planId = buildPlanId("issue-edit-add", targetKey, planHash);

    const before = await loadIssueBeforeSnapshot(client, issueIdOrKey);
    const diff = buildDiffSummary({
      before,
      plannedOperations: plannedActions,
      afterIntent: {
        issue: issueIdOrKey,
        actionKinds: plannedActions.map((a) => a.kind),
      },
      warnings,
      destructiveMarkers,
    });

    const permissionRequirements = mapActionsToPermissionRequirements(actions, {
      includeEditFields: false,
    });
    const preflightContext = {
      issueKey: issueIdOrKey,
    };
    const preflightIntent = buildPreflightIntent(permissionRequirements, preflightContext);

    if (operationMode === "prepare") {
      workflowId = createWorkflow(args, "issue-edit-add");
      result = {
        mode: "issue-edit-add-prepare",
        issue: issueIdOrKey,
        planId,
        workflowId,
        warnings,
      };
      return result;
    }

    if (operationMode === "show-changes") {
      workflowId = validateStage(args, "issue-edit-add", ["prepare"]);
      recordStage("show-changes");
      result = {
        mode: "issue-edit-add-show-changes",
        issue: issueIdOrKey,
        planId,
        diff,
        warnings,
        preflightIntent,
        instruction: ADD_APPROVAL_INSTRUCTION,
      };
      return result;
    }

    if (hasMutation && !approvalObtained) {
      throw new CliError("Finalize requires --human-approval-obtained after explicit approval.", 3);
    }

    workflowId = validateStage(args, "issue-edit-add", ["prepare", "show-changes"]);

    const preflight = await runPermissionPreflight(client, args, {
      commandName: "issue edit add finalize",
      requirements: permissionRequirements,
      context: preflightContext,
    });

    const actionResult = await executeActionPlan(client, actions, false);
    const verification = await verifyMutationIssueExists(client, issueIdOrKey);
    const actionWarnings = buildActionWarnings(actionResult);

    if (actionResult.incomplete) {
      status = "incomplete";
      result = {
        mode: "issue-edit-add-finalize",
        issue: issueIdOrKey,
        updated: hasMutation,
        actionResult,
        verification,
        warnings: [...warnings, ...actionWarnings],
        preflight,
      };
      recordSuccess();
    } else {
      result = {
        mode: "issue-edit-add-finalize",
        issue: issueIdOrKey,
        updated: hasMutation,
        actionResult,
        verification,
        warnings: [...warnings, ...actionWarnings],
        preflight,
      };
      recordSuccess();
    }
  } catch (err) {
    status = "failure";
    error = err.message;
    result = {};

    if (operationMode === "finalize") {
      const failureResult = recordFailure();
      if (!failureResult.shouldRetry) {
        error = `Finalize failed and workflow retries exhausted (${3 - failureResult.retriesRemaining}/3). Clear .jira-pipe.json and restart from --operation-mode prepare. Underlying error: ${err.message}`;
      } else if (failureResult.retriesRemaining < 3) {
        error = `Finalize failed (retries remaining: ${failureResult.retriesRemaining}). Fix the issue and retry --operation-mode finalize. Underlying error: ${err.message}`;
      }
    }

    throw err;
  } finally {
    const finishedAt = new Date();
    const stage = operationMode;
    const logPayload = {
      tool_name: "agent-jira-cli",
      command: "issue edit add",
      user_email: userEmail,
      status,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: Math.abs(finishedAt.getTime() - startedAt.getTime()),
      input_flags: inputFlags,
      result,
      metadata: {
        stage,
        "workflow-id": workflowId
      },
      error,
    };
    const logErrors = await saveLog(logPayload, { envDir: args["env-dir"] });

    if (status === "success" || status === "incomplete") {
      if (logErrors) {
        result.logErrors = logErrors;
      }
      output(result);
    }
  }
}

function buildAddWarnings(actions) {
  const warnings = [];
  if (actions.some((a) => a.kind === "link")) {
    warnings.push("Issue link side-effects requested; verify link target and type before finalize.");
  }
  return warnings;
}

function buildActionWarnings(actionResult) {
  const warnings = [];
  if (!actionResult || !Array.isArray(actionResult.actions)) return warnings;

  for (const action of actionResult.actions) {
    if (action.success === false) {
      warnings.push(`${action.kind} failed: ${action.error}`);
    }
  }
  return warnings;
}

async function loadIssueBeforeSnapshot(client, issueIdOrKey) {
  try {
    const issue = await client.getIssue(issueIdOrKey, 3, "summary,status,assignee,labels");
    return {
      key: issue?.key || issueIdOrKey,
      summary: issue?.fields?.summary || null,
      status: issue?.fields?.status?.name || null,
      assignee: issue?.fields?.assignee?.displayName || null,
      labels: issue?.fields?.labels || [],
    };
  } catch (err) {
    return { key: issueIdOrKey, error: err.message };
  }
}

async function verifyMutationIssueExists(client, issueIdOrKey) {
  const checks = [];
  try {
    const issue = await client.getIssue(issueIdOrKey, 3, "summary");
    checks.push({ name: "issue-exists", passed: Boolean(issue?.id || issue?.key) });
  } catch (err) {
    checks.push({ name: "issue-exists", passed: false, message: err.message });
  }
  return {
    passed: checks.every((c) => c.passed),
    checks,
  };
}

module.exports = {
  issueEditAddCommand,
};
