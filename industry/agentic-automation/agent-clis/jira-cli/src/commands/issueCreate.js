const { CliError } = require("../errors");
const {
  assertRequiredFlag,
  assertExactlyOneOf,
  assertRequiredWith,
} = require("../utils/flagValidator");
const {
  buildActionPlan,
  executeActionPlan,
  summarizeActionPlan,
  truncate,
  mapActionsToPermissionRequirements,
} = require("../utils/issueActions");
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
const PRESETS = require("../jiraPresetRegistry.json");
const { saveLog, extractInputFlags } = require("../log");
const { toAdf } = require("../utils/adf");
const { toInt } = require("../utils/pagination");
const {
  createWorkflow,
  validateStage,
  recordStage,
  recordSuccess,
  recordFailure,
} = require("../utils/workflowIdManager");

const APPROVAL_INSTRUCTION =
  "YOU ARE REQUIRED TO SHARE THESE DETAILS WITH YOUR HUMAN AND ASK THEM IF THEY AGREE WITH THE UPDATES ABOUT TO BE MADE. IF THE HUMAN AGREES, RERUN THE EXACT SAME COMMAND WITH THE --HUMAN-APPROVAL-OBTAINED FLAG APPENDED OTHERWISE DON'T RERUN IT.";

async function issueCreateCommand(client, args, output) {
  const startedAt = new Date();
  const userEmail = client?.email || "unknown";
  const inputFlags = extractInputFlags(args, "issue create");

  let status = "success";
  let result = {};
  let error = null;
  let workflowId = null;

  const operationMode = String(args["operation-mode"] || "show-changes").toLowerCase();
  const presetResolution = resolvePresetArgs(args);
  const effectiveArgs = presetResolution.args;
  const summary = effectiveArgs.summary;
  const descriptionText = effectiveArgs.description || "";
  const approvalObtained = Boolean(args["human-approval-obtained"] || args.yes);

  requireNoDryRun(args, "issue create");

  try {
    if (!["prepare", "show-changes", "finalize"].includes(operationMode)) {
      throw new CliError("Invalid --operation-mode for issue create. Allowed: prepare, show-changes, finalize", 3);
    }

    assertExactlyOneOf(
      effectiveArgs,
      ["project-id", "project-key", "project-query"],
      "project selector",
      "issue create"
    );
    assertExactlyOneOf(
      effectiveArgs,
      ["issue-type-id", "issue-type-name"],
      "issue type selector",
      "issue create"
    );

    assertRequiredFlag(effectiveArgs, "summary", "issue create");
    assertRequiredWith(effectiveArgs, "link-type", ["link-issue"], "issue create");
    assertRequiredWith(effectiveArgs, "link-issue", ["link-type"], "issue create");
    if (effectiveArgs["transition-id"]) {
      throw new CliError(
        "Flag --transition-id is not supported for issue create. Use issue edit replace to apply a workflow transition.",
        3
      );
    }

    if (summary.length > 255) {
      throw new CliError("Summary exceeds Jira 255 character limit", 3);
    }

    const project = await resolveProject(client, effectiveArgs);
    if (project.ambiguous) {
      result = {
        mode: "issue-create-project-selection-required",
        message:
          "Multiple projects matched your query. Choose one from candidateProjects and rerun issue create with --project-id <id>, or refine --project-query and retry.",
        candidateProjects: project.projects,
      };
      return result;
    }

    const issueType = await resolveIssueType(client, project.id, effectiveArgs);

    const fields = {
      project: project.id ? { id: project.id } : { key: project.key },
      summary,
      description: toAdf(descriptionText),
      issuetype: { id: issueType.id },
    };

    const targetKey = String(project.id || project.key || "project");
    const actor = String(client?.email || "unknown-actor");
    const previewActions = buildActionPlan("<created-issue>", effectiveArgs, { disableTransition: true });
    const plannedActions = summarizeActionPlan(previewActions);
    const warnings = buildCreateWarnings(effectiveArgs);
    const destructiveMarkers = [];
    const planHash = buildPlanHash({
      fields,
      plannedActions,
      command: "issue-create",
    });
    const planId = buildPlanId("issue-create", targetKey, planHash);

    const diff = buildDiffSummary({
      before: null,
      plannedOperations: plannedActions,
      afterIntent: {
        project: fields.project,
        issueType: fields.issuetype,
        summary: truncate(fields.summary, 160),
        description: truncate(descriptionText, 160),
        presetApplied: presetResolution.applied,
        presetOverrides: presetResolution.overrides,
      },
      warnings,
      destructiveMarkers,
    });

    const permissionRequirements = mapActionsToPermissionRequirements(previewActions, {
      includeCreateIssue: true,
    });
    const preflightContext = {
      projectKey: project.key || null,
      projectId: project.id || null,
    };
    const preflightIntent = buildPreflightIntent(permissionRequirements, preflightContext);

    if (operationMode === "prepare") {
      workflowId = createWorkflow(effectiveArgs, "issue-create");
      result = {
        mode: "issue-create-prepare",
        planId,
        presetApplied: presetResolution.applied,
        presetOverrides: presetResolution.overrides,
        workflowId,
        warnings,
      };
      return result;
    }

    if (operationMode === "show-changes") {
      workflowId = validateStage(effectiveArgs, "issue-create", ["prepare"]);
      recordStage("show-changes");
      result = {
        mode: "issue-create-show-changes",
        planId,
        presetApplied: presetResolution.applied,
        presetOverrides: presetResolution.overrides,
        diff,
        warnings,
        preflightIntent,
        instruction: APPROVAL_INSTRUCTION,
      };
      return result;
    }

    if (!approvalObtained) {
      throw new CliError("Finalize requires --human-approval-obtained after explicit approval.", 3);
    }

    workflowId = validateStage(effectiveArgs, "issue-create", ["prepare", "show-changes"]);

    const preflight = await runPermissionPreflight(client, effectiveArgs, {
      commandName: "issue create finalize",
      requirements: permissionRequirements,
      context: preflightContext,
    });

    const userLabels = effectiveArgs.labels ? String(effectiveArgs.labels).split(",").map(s => s.trim()).filter(Boolean) : [];
    fields.labels = userLabels.length > 0 ? userLabels : undefined;

    const created = await client.createIssue(fields);
    const targetIssue = created.key || created.id;
    const actions = buildActionPlan(targetIssue, effectiveArgs, { disableTransition: true });
    const actionResult = await executeActionPlan(client, actions, false);

    const verification = await verifyCreateMutation(client, targetIssue);
    const actionWarnings = buildActionWarnings(actionResult);

    if (actionResult.incomplete) {
      status = "incomplete";
      result = {
        mode: "issue-create-finalize",
        created,
        actionResult,
        verification,
        warnings: [...warnings, ...actionWarnings],
        preflight,
        presetApplied: presetResolution.applied,
        presetOverrides: presetResolution.overrides,
      };
      recordSuccess();
    } else {
      result = {
        mode: "issue-create-finalize",
        created,
        actionResult,
        verification,
        warnings: [...warnings, ...actionWarnings],
        preflight,
        presetApplied: presetResolution.applied,
        presetOverrides: presetResolution.overrides,
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
      command: "issue create",
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

function buildCreateWarnings(args) {
  const warnings = [];
  if (args["project-query"]) {
    warnings.push("Project resolved via query; verify target confidence before finalize.");
  }
  if (args["issue-type-name"] && !args["issue-type-id"]) {
    warnings.push("Issue type resolved by name; verify exact issue type before finalize.");
  }
  if (args["link-type"] || args["link-issue"]) {
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

function resolvePresetArgs(args) {
  const presetFlags = [
    "incident-report",
    "bug-triage",
    "change-request",
    "release-blocker",
  ];
  const selected = presetFlags.filter((flag) => Boolean(args[flag]));
  if (selected.length > 1) {
    throw new CliError(
      `Choose only one issue-create preset flag: ${presetFlags.map((f) => `--${f}`).join(", ")}`,
      3
    );
  }

  if (selected.length === 0) {
    return {
      args,
      applied: null,
      overrides: [],
    };
  }

  const presetKey = selected[0];
  const preset = PRESETS[presetKey] || null;
  if (!preset) {
    throw new CliError(`Unknown preset configuration for --${presetKey}.`, 3);
  }

  const next = { ...args };
  const applied = {
    preset: presetKey,
    summaryPrefix: preset.summaryPrefix,
    labelsSeed: preset.labelsSeed,
    issueTypeHint: preset.issueTypeHint,
  };
  const overrides = [];

  if (!next.summary) {
    next.summary = `${preset.summaryPrefix} TBD`;
  } else {
    overrides.push("summary");
  }

  if (!next.description) {
    next.description = preset.descriptionTemplate;
  } else {
    overrides.push("description");
  }

  if (!next.labels) {
    next.labels = preset.labelsSeed.join(",");
  } else {
    overrides.push("labels");
  }

  if (!next["issue-type-id"] && !next["issue-type-name"] && preset.issueTypeHint) {
    next["issue-type-name"] = preset.issueTypeHint;
  } else if (next["issue-type-id"] || next["issue-type-name"]) {
    overrides.push("issue-type");
  }

  return {
    args: next,
    applied,
    overrides: Array.from(new Set(overrides)),
  };
}

async function verifyCreateMutation(client, issueIdOrKey) {
  const checks = [];
  try {
    const issue = await client.getIssue(issueIdOrKey, 3, "summary,status");
    checks.push({ name: "issue-exists", passed: Boolean(issue?.id || issue?.key) });
  } catch (err) {
    checks.push({ name: "issue-exists", passed: false, message: err.message });
  }
  return {
    passed: checks.every((c) => c.passed),
    checks,
  };
}

async function resolveProject(client, args) {
  if (args["project-id"]) {
    return { id: args["project-id"] };
  }

  if (args["project-key"]) {
    const query = String(args["project-key"]).toUpperCase();
    const result = await client.searchProjects(query, 0, 50);
    const projects = result.values || [];
    const match = projects.find(p => p.key && p.key.toUpperCase() === query);
    
    if (match) {
      return { id: match.id, key: match.key, name: match.name };
    }
    throw new CliError(`Project key '${query}' not found. Please verify the key or use --project-id.`, 5);
  }

  const query = args["project-query"];
  if (!query) {
    throw new CliError(
      "Missing project selector: provide --project-id, --project-key, or --project-query",
      3
    );
  }

  const maxAttempts = 3;
  const pageSize = 25;

  let startAt = 0;
  const candidates = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await client.searchProjects(query, startAt, pageSize);
    const projects = result.values || [];

    for (const project of projects) {
      candidates.push({
        id: project.id,
        key: project.key,
        name: project.name,
      });
    }

    const exactMatches = projects.filter((project) => {
      const key = typeof project.key === "string" ? project.key.toLowerCase() : "";
      const name = typeof project.name === "string" ? project.name.toLowerCase() : "";
      const q = query.toLowerCase();
      return key === q || name === q;
    });

    if (exactMatches.length === 1) {
      return { id: exactMatches[0].id, key: exactMatches[0].key };
    }

    if (projects.length === 1) {
      return { id: projects[0].id, key: projects[0].key };
    }

    startAt += pageSize;
  }

  const uniqueCandidates = Array.from(
    new Map(candidates.map((project) => [project.id, project])).values()
  );

  if (uniqueCandidates.length > 1) {
    return {
      ambiguous: true,
      query,
      attempts: maxAttempts,
      projects: uniqueCandidates,
    };
  }

  if (uniqueCandidates.length === 1) {
    return { id: uniqueCandidates[0].id, key: uniqueCandidates[0].key };
  }

  throw new CliError(
    `Project not found after ${maxAttempts} attempts for query '${query}'. Refine --project-query and retry.`,
    5
  );
}

async function resolveIssueType(client, projectId, args) {
  if (args["issue-type-id"]) {
    return { id: args["issue-type-id"] };
  }

  const issueTypeName = args["issue-type-name"];
  if (!issueTypeName) {
    throw new CliError("Missing issue type: provide --issue-type-id or --issue-type-name", 3);
  }

  if (!projectId) {
    throw new CliError(
      "Issue type lookup by name requires project id resolution first",
      6
    );
  }

  const payload = await client.getIssueTypesForProject(projectId);
  const issueTypes = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.issueTypes)
      ? payload.issueTypes
      : [];

  const matches = issueTypes.filter(
    (item) => item && typeof item.name === "string" && item.name.toLowerCase() === issueTypeName.toLowerCase()
  );

  if (matches.length === 1) {
    return { id: matches[0].id, name: matches[0].name };
  }

  if (matches.length > 1) {
    throw new CliError(
      `Issue type '${issueTypeName}' is ambiguous. Provide --issue-type-id instead`,
      6,
      { matches }
    );
  }

  throw new CliError(`Issue type '${issueTypeName}' not found for project ${projectId}`, 6);
}

module.exports = {
  issueCreateCommand,
};