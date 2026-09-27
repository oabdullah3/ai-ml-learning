const fs = require("fs");
const path = require("path");
const os = require("os");
function getTelemetryApiUrl(options = {}) {
  const envDir = options.envDir || _envDir || process.env.JIRA_ENV_DIR;

  if (envDir) {
    const envLocalPath = path.resolve(envDir, ".env.local");
    const envLocalEnv = readDotEnvFile(envLocalPath);
    if (envLocalEnv.TELEMETRY_API_URL) {
      return envLocalEnv.TELEMETRY_API_URL;
    }
  }

  if (process.env.TELEMETRY_API_URL) {
    return process.env.TELEMETRY_API_URL;
  }

  return "https://telemetry.example.invalid/api/v1/logs";
}

let _envDir = null;
let _skipLog = false;
let _rawLogs = false;

function setEnvDir(envDir) {
  _envDir = envDir;
}

function skipLog() {
  _skipLog = true;
}

function isSkipLog() {
  return _skipLog;
}

function setRawLogs(rawLogs) {
  _rawLogs = parseBooleanFlag(rawLogs, false);
}

function isRawLogs() {
  return _rawLogs;
}

function readDotEnvFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    return {};
  }

  const result = {};
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const exportStripped = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const idx = exportStripped.indexOf("=");
    if (idx < 1) continue;

    const key = exportStripped.slice(0, idx).trim();
    const valueRaw = exportStripped.slice(idx + 1).trim();
    result[key] = stripWrappingQuotes(valueRaw);
  }

  return result;
}

function stripWrappingQuotes(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function simplifyLogPayload(logPayload) {
  if (!logPayload || typeof logPayload !== "object") return logPayload;

  const commandSimplifiers = {
    me: simplifyMePayload,
    "issue edit add": simplifyIssueEditAddPayload,
    "issue edit replace": simplifyIssueEditReplacePayload,
    "project search": simplifyProjectSearchPayload,
    "issue search": simplifyIssueSearchPayload,
    "issue create": simplifyIssueCreatePayload,
  };

  const simplify = commandSimplifiers[logPayload.command];
  if (!simplify) return logPayload;
  return simplify(logPayload);
}

function shouldSimplifyLogPayload(options = {}) {
  if (options.rawLogs !== undefined) return !parseBooleanFlag(options.rawLogs, false);
  if (_rawLogs) return false;
  if (options.simplifyLogs !== undefined) return parseBooleanFlag(options.simplifyLogs, true);

  const envDir = options.envDir || _envDir || process.env.JIRA_ENV_DIR;
  const simplificationValue = readEnvValue(envDir, "JIRA_LOG_SIMPLIFICATION");
  if (simplificationValue !== undefined) return parseBooleanFlag(simplificationValue, true);

  const rawLogsValue = readEnvValue(envDir, "JIRA_RAW_LOGS");
  if (rawLogsValue !== undefined) return !parseBooleanFlag(rawLogsValue, false);

  return true;
}

function readEnvValue(envDir, key) {
  const envFiles = [".env.local", ".env"];
  for (const envFile of envFiles) {
    if (!envDir) continue;
    const env = readDotEnvFile(path.resolve(envDir, envFile));
    if (env[key] !== undefined) return env[key];
  }

  return process.env[key];
}

function parseBooleanFlag(value, defaultValue) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === "boolean") return value;

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on", "enabled", "enable", "simplify", "simplified"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off", "disabled", "disable", "raw"].includes(normalized)) return false;
  return defaultValue;
}

function simplifyMePayload(logPayload) {
  return {
    ...logPayload,
    result: simplifyMeResult(logPayload.result),
  };
}

function simplifyMeResult(result) {
  if (!result || typeof result !== "object") return result;

  const simplified = {};
  if (result.profile) simplified.profile = compactProfile(result.profile);

  for (const categoryName of ["assigned", "reported", "watched", "recent"]) {
    const items = Array.isArray(result[categoryName]) ? result[categoryName] : [];
    if (items.length === 0) continue;

    simplified[categoryName] = items
      .map((issue) => {
        const key = issue?.key;
        if (!key) return null;

        const enrichmentPagination = issue?.enrichmentPagination;
        return {
          [key]: enrichmentPagination && typeof enrichmentPagination === "object"
            ? compactPlainObject(enrichmentPagination)
            : {},
        };
      })
      .filter((item) => item !== null);
  }

  return simplified;
}

function summarizeMeCategory(result, categoryName) {
  const items = Array.isArray(result[categoryName]) ? result[categoryName] : [];
  const pagination = result.pagination?.[categoryName] || {};

  return {
    total: pagination.total,
    returned: items.length,
    pagination: compactPaginationMeta(pagination),
    issues: items.map(summarizeIssue),
  };
}

function compactProfile(profile) {
  if (!profile || typeof profile !== "object") return profile;

  const fields = ["accountId", "displayName", "emailAddress", "timeZone"];
  const compact = {};
  for (const field of fields) {
    if (profile[field] !== undefined) compact[field] = profile[field];
  }
  return compact;
}

function summarizeIssue(issue) {
  if (!issue || typeof issue !== "object") return issue;

  const fields = issue.fields || {};
  const summary = {};

  if (issue.key) summary.key = issue.key;
  if (issue.id) summary.id = issue.id;
  if (fields.summary || issue.summary) summary.summary = fields.summary || issue.summary;
  if (fields.updated || issue.updated) summary.updated = fields.updated || issue.updated;
  if (fields.issuetype) summary.issueType = compactIssueType(fields.issuetype);
  if (fields.status) summary.status = compactStatus(fields.status);
  if (fields.priority) summary.priority = compactPriority(fields.priority);
  if (fields.assignee) summary.assignee = compactUser(fields.assignee);

  const enrichments = summarizeIssueEnrichments(issue);
  if (Object.keys(enrichments).length > 0) summary.enrichments = enrichments;

  return summary;
}

function compactIssueType(issueType) {
  return compactNamedEntity(issueType, ["id", "name"]);
}

function compactStatus(status) {
  const compact = compactNamedEntity(status, ["id", "name"]);
  if (status.statusCategory?.name) compact.category = status.statusCategory.name;
  return compact;
}

function compactPriority(priority) {
  return compactNamedEntity(priority, ["id", "name"]);
}

function compactUser(user) {
  const compact = compactNamedEntity(user, ["accountId", "displayName"]);
  if (user.emailAddress) compact.emailAddress = user.emailAddress;
  return compact;
}

function compactNamedEntity(entity, fields) {
  const compact = {};
  if (!entity || typeof entity !== "object") return compact;
  for (const field of fields) {
    if (entity[field] !== undefined) compact[field] = entity[field];
  }
  return compact;
}

function compactPaginationMeta(pagination) {
  if (!pagination || typeof pagination !== "object") return pagination;

  const fields = ["total", "startAt", "maxResults", "returned", "strategy"];
  const compact = {};
  for (const field of fields) {
    if (pagination[field] !== undefined) compact[field] = pagination[field];
  }
  return compact;
}

function summarizeIssueEnrichments(issue) {
  const enrichments = {};
  const enrichmentKinds = ["comments", "transitions", "assignableUsers", "worklogs", "attachments"];

  for (const kind of enrichmentKinds) {
    if (Array.isArray(issue[kind])) {
      enrichments[kind] = {
        returned: issue[kind].length,
        total: issue.enrichmentPagination?.[kind]?.total ?? issue[`${kind}Total`],
      };
    }
  }

  if (issue.enrichmentPagination && typeof issue.enrichmentPagination === "object") {
    for (const kind of enrichmentKinds) {
      if (!issue.enrichmentPagination[kind]) continue;
      enrichments[kind] = {
        ...compactPaginationMeta(issue.enrichmentPagination[kind]),
        ...(Array.isArray(issue[kind]) ? { returned: issue[kind].length } : {}),
      };
    }
  }

  if (issue.assignableUsersError) {
    enrichments.assignableUsersError = issue.assignableUsersError;
  }

  return enrichments;
}

function simplifyIssueEditAddPayload(logPayload) {
  return {
    ...logPayload,
    result: simplifyIssueEditAddResult(logPayload.result),
  };
}

function simplifyIssueEditReplacePayload(logPayload) {
  return {
    ...logPayload,
    result: simplifyIssueEditReplaceResult(logPayload.result),
  };
}

function simplifyProjectSearchPayload(logPayload) {
  return {
    ...logPayload,
    result: simplifyProjectSearchResult(logPayload.result),
  };
}

function simplifyIssueSearchPayload(logPayload) {
  return {
    ...logPayload,
    result: simplifyIssueSearchResult(logPayload.result),
  };
}

function simplifyIssueCreatePayload(logPayload) {
  return {
    ...logPayload,
    result: simplifyIssueCreateResult(logPayload.result),
  };
}

function simplifyProjectSearchResult(result) {
  if (!result || typeof result !== "object") return result;

  const simplified = {};
  if (result.pagination) simplified.pagination = compactPaginationMeta(result.pagination);

  if (Array.isArray(result.projects)) {
    simplified.projects = result.projects
      .map(summarizeProject)
      .filter((project) => project !== null);
  }

  return simplified;
}

function summarizeProject(project) {
  if (!project || typeof project !== "object") return project;

  const key = project.key || project.id;
  if (!key) return null;

  const issueTypes = Array.isArray(project.issueTypes)
    ? project.issueTypes.map((issueType) => issueType?.name).filter((name) => name !== undefined && name !== null)
    : [];

  const components = Array.isArray(project.components)
    ? project.components.map((component) => component?.name).filter((name) => name !== undefined && name !== null)
    : [];

  return {
    [key]: {
      name: project.name,
      id: project.id,
      issueTypes,
      components,
    },
  };
}

function simplifyIssueSearchResult(result) {
  if (!result || typeof result !== "object") return result;

  const simplified = {};
  if (result.jql !== undefined) simplified.jql = result.jql;
  if (result.pagination) simplified.pagination = result.pagination;
  if (result.message) simplified.message = result.message;
  if (result.issueData) simplified.issueData = compactIssueIdentity(result.issueData);
  if (Array.isArray(result.issues)) simplified.issues = result.issues.map(compactIssueIdentity);

  if (result.enrichmentPagination && typeof result.enrichmentPagination === "object") {
    simplified.enrichmentPagination = compactPlainObject(result.enrichmentPagination);
  }

  return simplified;
}

function compactIssueIdentity(issue) {
  if (!issue || typeof issue !== "object") return issue;

  const compact = {};
  if (issue.id !== undefined) compact.id = issue.id;
  if (issue.key !== undefined) compact.key = issue.key;
  return compact;
}

function simplifyIssueEditAddResult(result) {
  if (!result || typeof result !== "object") return result;

  const simplified = {};
  for (const field of ["mode", "issue", "planId", "workflowId", "updated", "instruction"]) {
    if (result[field] !== undefined) simplified[field] = result[field];
  }

  if (result.diff) simplified.diff = simplifyIssueEditAddDiff(result.diff);
  if (Array.isArray(result.warnings)) simplified.warnings = result.warnings;
  if (result.actionResult) simplified.actionResult = summarizeIssueCreateActionResult(result.actionResult);
  if (result.verification) simplified.verification = summarizeVerification(result.verification);

  return simplified;
}

function simplifyIssueEditAddDiff(diff) {
  if (!diff || typeof diff !== "object") return diff;

  const simplified = {};
  if (diff.before !== undefined) simplified.before = diff.before;
  if (Array.isArray(diff.plannedOperations)) simplified.plannedOperations = diff.plannedOperations.length;
  if (diff.afterIntent && typeof diff.afterIntent === "object") {
    simplified.afterIntent = compactPlainObject(diff.afterIntent);
  }
  if (Array.isArray(diff.destructiveMarkers)) simplified.destructiveMarkers = diff.destructiveMarkers;
  return simplified;
}

function simplifyIssueEditReplaceResult(result) {
  if (!result || typeof result !== "object") return result;

  const simplified = {};
  
  const topLevelFields = [
    "mode", "issue", "planId", "workflowId", "updated", "instruction", 
    "patchMode", "patchFields", "patchApplied", "primaryResult" // <-- Replace specifics!
  ];
  for (const field of topLevelFields) {
    if (result[field] !== undefined) simplified[field] = result[field];
  }

  if (result.diff) simplified.diff = simplifyDiff(result.diff); 
  if (Array.isArray(result.warnings)) simplified.warnings = result.warnings;
  if (result.actionResult) simplified.actionResult = summarizeIssueCreateActionResult(result.actionResult);
  if (result.verification) simplified.verification = summarizeVerification(result.verification);

  return simplified;
}

function simplifyIssueCreateResult(result) {
  if (!result || typeof result !== "object") return result;

  const simplified = {};
  for (const field of ["mode", "planId", "workflowId", "presetApplied", "presetOverrides", "instruction"]) {
    if (result[field] !== undefined) simplified[field] = result[field];
  }

  if (result.created) simplified.created = compactCreatedIssue(result.created);
  if (result.diff) simplified.diff = simplifyIssueCreateDiff(result.diff);
  if (Array.isArray(result.warnings)) simplified.warnings = result.warnings;
  if (result.actionResult) simplified.actionResult = summarizeIssueCreateActionResult(result.actionResult);
  if (result.verification) simplified.verification = summarizeVerification(result.verification);

  return simplified;
}

function simplifyIssueCreateDiff(diff) {
  if (!diff || typeof diff !== "object") return diff;

  const simplified = {};
  if (diff.before !== undefined) simplified.before = diff.before;
  if (Array.isArray(diff.plannedOperations)) simplified.plannedOperations = diff.plannedOperations.length;
  if (diff.afterIntent && typeof diff.afterIntent === "object") {
    simplified.afterIntent = {};
    if (diff.afterIntent.project) {
      simplified.afterIntent.project = compactNamedEntity(diff.afterIntent.project, ["id", "key"]);
    }
    if (diff.afterIntent.issueType) {
      simplified.afterIntent.issueType = compactNamedEntity(diff.afterIntent.issueType, ["id", "name"]);
    }
  }
  if (Array.isArray(diff.destructiveMarkers)) simplified.destructiveMarkers = diff.destructiveMarkers;
  return simplified;
}

function summarizeIssueCreateActionResult(actionResult) {
  if (!actionResult || typeof actionResult !== "object") return actionResult;

  const summarized = {};
  if (actionResult.dryRun !== undefined) summarized.dryRun = actionResult.dryRun;
  if (actionResult.incomplete !== undefined) summarized.incomplete = actionResult.incomplete;

  if (Array.isArray(actionResult.actions)) {
    const successfulActions = [];
    const failedActions = [];
    for (const action of actionResult.actions) {
      if (!action || !action.kind) continue;
      if (action.success === false) failedActions.push(action.kind);
      else successfulActions.push(action.kind);
    }
    summarized.successfulActions = successfulActions;
    summarized.failedActions = failedActions;
  } else {
    if (Array.isArray(actionResult.successfulActions)) summarized.successfulActions = actionResult.successfulActions;
    if (Array.isArray(actionResult.failedActions)) summarized.failedActions = actionResult.failedActions;
  }

  return summarized;
}

function simplifyWorkflowResult(result) {
  if (!result || typeof result !== "object") return result;

  const simplified = {};
  for (const field of ["mode", "issue", "planId", "workflowId", "version", "presetApplied", "presetOverrides", "patchMode", "patchFields", "patchApplied", "updated", "instruction"]) {
    if (result[field] !== undefined) simplified[field] = result[field];
  }

  if (result.created) simplified.created = compactCreatedIssue(result.created);
  if (result.diff) simplified.diff = simplifyDiff(result.diff);
  if (Array.isArray(result.warnings)) simplified.warnings = result.warnings;
  if (result.preflightIntent) simplified.preflightIntent = compactPreflightIntent(result.preflightIntent);
  if (result.actionResult) simplified.actionResult = summarizeActionResult(result.actionResult);
  if (result.verification) simplified.verification = summarizeVerification(result.verification);
  if (result.preflight) simplified.preflight = summarizePreflight(result.preflight);
  if (result.resolution) simplified.resolution = compactResolution(result.resolution);

  return simplified;
}

function simplifyDiff(diff) {
  if (!diff || typeof diff !== "object") return diff;

  const simplified = {};
  if (diff.before !== undefined) simplified.before = compactBeforeSnapshot(diff.before);
  if (Array.isArray(diff.plannedOperations)) {
    simplified.plannedOperations = diff.plannedOperations.map(summarizePlannedOperation);
  }
  if (diff.afterIntent) simplified.afterIntent = compactAfterIntent(diff.afterIntent);
  if (Array.isArray(diff.warnings)) simplified.warnings = diff.warnings;
  if (Array.isArray(diff.destructiveMarkers)) simplified.destructiveMarkers = diff.destructiveMarkers;
  return simplified;
}

function compactBeforeSnapshot(before) {
  if (before === null || before === undefined) return before;
  if (typeof before !== "object") return before;

  const compact = {};
  for (const field of ["key", "summary", "status", "assignee", "dueDate", "error"]) {
    if (before[field] !== undefined) compact[field] = typeof before[field] === "string" ? truncateForLog(before[field]) : before[field];
  }
  if (Array.isArray(before.labels)) compact.labels = before.labels;
  if (typeof before.description === "string") compact.description = truncateForLog(before.description, 240);
  return compact;
}

function summarizePlannedOperation(operation) {
  if (!operation || typeof operation !== "object") return operation;

  const summarized = { kind: operation.kind };
  if (operation.issue) summarized.issue = operation.issue;

  if (operation.kind === "comment") {
    summarized.body = truncateForLog(operation.body || operation.payload?.body);
  } else if (operation.kind === "worklog") {
    summarized.version = operation.version;
    summarized.timeSpent = operation.timeSpent || operation.payload?.timeSpent;
    summarized.comment = truncateForLog(operation.comment || operation.payload?.comment);
    summarized.started = operation.started || operation.payload?.started;
  } else if (operation.kind === "dates") {
    summarized.payload = compactPayload(operation.payload, ["startDate", "dueDate"]);
  } else if (operation.kind === "priority") {
    summarized.priorityId = operation.priorityId;
  } else if (operation.kind === "components") {
    summarized.componentIds = operation.componentIds;
  } else if (operation.kind === "parent") {
    summarized.parentKey = operation.parentKey;
    summarized.parentId = operation.parentId;
  } else if (operation.kind === "environment") {
    summarized.fieldId = operation.fieldId;
    summarized.fieldName = operation.fieldName;
    summarized.value = truncateForLog(operation.value);
  } else if (operation.kind === "story-points") {
    summarized.fieldId = operation.fieldId;
    summarized.fieldName = operation.fieldName;
    summarized.value = operation.value;
  } else if (operation.kind === "timetracking-estimate") {
    summarized.originalEstimate = operation.originalEstimate;
  } else if (operation.kind === "acceptance") {
    summarized.fieldId = operation.fieldId;
    summarized.fieldName = operation.fieldName;
    summarized.value = truncateForLog(operation.value);
  } else if (operation.kind === "attachment") {
    summarized.fileName = operation.fileName || operation.filePath;
  } else if (operation.kind === "assignee") {
    summarized.accountId = operation.accountId;
  } else if (operation.kind === "link") {
    summarized.linkType = operation.linkType;
    summarized.targetIssue = operation.targetIssue;
  } else if (operation.kind === "transition") {
    summarized.transitionId = operation.transitionId;
  } else if (operation.kind === "labels") {
    summarized.add = operation.add;
    summarized.remove = operation.remove;
    summarized.note = operation.note;
  } else if (operation.kind === "details") {
    summarized.version = operation.version;
    summarized.fields = operation.fields;
  } else if (operation.kind === "primary-replace") {
    summarized.payload = compactPrimaryReplacePayload(operation.payload);
  } else {
    return compactPlainObject(operation);
  }

  return summarized;
}

function compactPrimaryReplacePayload(payload) {
  if (!payload || typeof payload !== "object") return payload;

  const compact = {};
  if (payload.version !== undefined) compact.version = payload.version;
  if (payload.update && typeof payload.update === "object") {
    compact.update = {};
    for (const [field, ops] of Object.entries(payload.update)) {
      if (field === "description") {
        compact.update[field] = [{ set: "doc" }];
      } else if (Array.isArray(ops)) {
        compact.update[field] = ops.map((op) => {
          if (op && typeof op === "object" && Object.prototype.hasOwnProperty.call(op, "set")) {
            return { set: typeof op.set === "string" ? truncateForLog(op.set) : op.set };
          }
          return compactPlainObject(op);
        });
      } else {
        compact.update[field] = compactPlainObject(ops);
      }
    }
  }
  return compact;
}

function compactAfterIntent(afterIntent) {
  if (!afterIntent || typeof afterIntent !== "object") return afterIntent;

  const compact = {};
  for (const [key, value] of Object.entries(afterIntent)) {
    if (Array.isArray(value)) {
      compact[key] = value.map((item) => typeof item === "string" ? truncateForLog(item) : compactPlainObject(item));
    } else if (value && typeof value === "object") {
      compact[key] = compactPlainObject(value);
    } else if (typeof value === "string") {
      compact[key] = truncateForLog(value);
    } else {
      compact[key] = value;
    }
  }
  return compact;
}

function compactPayload(payload, fields) {
  if (!payload || typeof payload !== "object") return payload;
  const compact = {};
  for (const field of fields) {
    if (payload[field] !== undefined) compact[field] = payload[field];
  }
  return compact;
}

function summarizeActionResult(actionResult) {
  if (!actionResult || typeof actionResult !== "object") return actionResult;

  const summarized = {};
  if (actionResult.dryRun !== undefined) summarized.dryRun = actionResult.dryRun;
  if (actionResult.incomplete !== undefined) summarized.incomplete = actionResult.incomplete;
  if (Array.isArray(actionResult.actions)) {
    summarized.actions = actionResult.actions.map(summarizeActionResultItem);
  }
  return summarized;
}

function summarizeActionResultItem(action) {
  if (!action || typeof action !== "object") return action;

  const summarized = { kind: action.kind };
  if (action.issue) summarized.issue = action.issue;
  if (action.success !== undefined) summarized.success = action.success;
  if (action.error) summarized.error = action.error;
  if (action.updated !== undefined) summarized.updated = action.updated;
  if (action.version !== undefined) summarized.version = action.version;
  if (action.stamp) summarized.stamp = action.stamp;
  if (action.fields) summarized.fields = action.fields;

  if (action.body) summarized.body = truncateForLog(action.body);
  if (action.timeSpent) summarized.timeSpent = action.timeSpent;
  if (typeof action.comment === "string") summarized.comment = truncateForLog(action.comment);
  else if (action.comment && typeof action.comment === "object") summarized.commentObject = summarizeComment(action.comment);
  if (action.started) summarized.started = action.started;
  if (action.originalEstimate) summarized.originalEstimate = action.originalEstimate;
  if (action.priorityId) summarized.priorityId = action.priorityId;
  if (Array.isArray(action.componentIds)) summarized.componentIds = action.componentIds;
  if (action.fieldId) summarized.fieldId = action.fieldId;
  if (action.fieldName) summarized.fieldName = action.fieldName;
  if (action.value !== undefined) summarized.value = action.value;
  if (action.linkType) summarized.linkType = action.linkType;
  if (action.targetIssue) summarized.targetIssue = action.targetIssue;
  if (action.transitionId) summarized.transitionId = action.transitionId;
  if (Array.isArray(action.add)) summarized.add = action.add;
  if (Array.isArray(action.remove)) summarized.remove = action.remove;

  if (action.commentObject) summarized.commentObject = summarizeComment(action.commentObject);
  if (action.worklog) summarized.worklog = summarizeWorklog(action.worklog);
  if (Array.isArray(action.attachment)) summarized.attachment = summarizeAttachments(action.attachment);
  if (action.issueData) summarized.issueData = summarizeIssue(action.issueData);

  return summarized;
}

function summarizeComment(comment) {
  if (!comment || typeof comment !== "object") return comment;

  const summarized = {};
  if (comment.id) summarized.id = comment.id;
  if (comment.author) summarized.author = compactUser(comment.author);
  if (comment.created) summarized.created = comment.created;
  if (typeof comment.body === "string") summarized.body = truncateForLog(comment.body);
  return summarized;
}

function summarizeWorklog(worklog) {
  if (!worklog || typeof worklog !== "object") return worklog;

  const summarized = {};
  if (worklog.id) summarized.id = worklog.id;
  if (worklog.author) summarized.author = compactUser(worklog.author);
  if (worklog.started) summarized.started = worklog.started;
  if (worklog.timeSpent) summarized.timeSpent = worklog.timeSpent;
  if (typeof worklog.comment === "string") summarized.comment = truncateForLog(worklog.comment);
  if (worklog.issueId) summarized.issueId = worklog.issueId;
  return summarized;
}

function summarizeAttachments(attachments) {
  return attachments.map((attachment) => {
    if (!attachment || typeof attachment !== "object") return attachment;
    const summarized = {};
    if (attachment.id) summarized.id = attachment.id;
    if (attachment.filename) summarized.filename = attachment.filename;
    if (attachment.size) summarized.size = attachment.size;
    return summarized;
  });
}

function summarizeVerification(verification) {
  if (!verification || typeof verification !== "object") return verification;

  const summarized = {};
  if (verification.passed !== undefined) summarized.passed = verification.passed;
  if (Array.isArray(verification.checks)) {
    summarized.checks = verification.checks.map((check) => compactPlainObject(check));
  }
  return summarized;
}

function summarizePreflight(preflight) {
  if (!preflight || typeof preflight !== "object") return preflight;

  const summarized = {};
  for (const field of ["skipped", "ok"]) {
    if (preflight[field] !== undefined) summarized[field] = preflight[field];
  }
  if (Array.isArray(preflight.checked)) {
    summarized.checked = preflight.checked.map((check) => compactPlainObject(check));
  }
  if (preflight.context) summarized.context = compactPlainObject(preflight.context);
  return summarized;
}

function compactPreflightIntent(preflightIntent) {
  if (!preflightIntent || typeof preflightIntent !== "object") return preflightIntent;

  const compact = {};
  if (preflightIntent.willRunByDefault !== undefined) compact.willRunByDefault = preflightIntent.willRunByDefault;
  if (Array.isArray(preflightIntent.requiredCategories)) {
    compact.requiredCategories = preflightIntent.requiredCategories.map((category) => compactPlainObject(category));
  }
  if (preflightIntent.context) compact.context = compactPlainObject(preflightIntent.context);
  return compact;
}

function compactCreatedIssue(created) {
  if (!created || typeof created !== "object") return created;
  return compactNamedEntity(created, ["id", "key"]);
}

function compactResolution(resolution) {
  if (!resolution || typeof resolution !== "object") return resolution;

  const compact = {};
  if (resolution.status) compact.status = resolution.status;
  if (resolution.selector) compact.selector = compactSelector(resolution.selector);
  if (Array.isArray(resolution.candidates)) compact.candidates = resolution.candidates.map(compactResolutionCandidate);
  if (resolution.selected !== undefined && resolution.selected !== null) compact.selected = compactResolutionValue(resolution.selected);
  if (resolution.instruction) compact.instruction = resolution.instruction;
  return compact;
}

function compactSelector(selector) {
  if (!selector || typeof selector !== "object") return selector;
  const compact = {};
  for (const [key, value] of Object.entries(selector)) {
    if (Array.isArray(value)) compact[key] = value.map((item) => compactResolutionValue(item));
    else compact[key] = compactResolutionValue(value);
  }
  return compact;
}

function compactResolutionCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") return candidate;
  return compactNamedEntity(candidate, ["id", "key", "name", "summary"]);
}

function compactResolutionValue(value) {
  if (Array.isArray(value)) return value.map((item) => compactResolutionValue(item));
  if (value && typeof value === "object") return compactPlainObject(value);
  return value;
}

function compactPlainObject(value) {
  if (value === null || value === undefined || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => compactPlainObject(item));

  const compact = {};
  for (const [key, nested] of Object.entries(value)) {
    if (Array.isArray(nested)) compact[key] = nested.map((item) => compactPlainObject(item));
    else if (nested && typeof nested === "object") compact[key] = compactPlainObject(nested);
    else if (typeof nested === "string") compact[key] = truncateForLog(nested);
    else compact[key] = nested;
  }
  return compact;
}

function truncateForLog(value, max = 160) {
  if (typeof value !== "string") return value;
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

function formatDateForFilename(date) {
  return date.toISOString().split("T")[0];
}

function formatDateTimeForFilename(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function getLogPayloadsDir() {
  const candidates = [
    path.join(process.cwd(), "log_payloads"),
    path.join(os.homedir(), "log_payloads"),
  ];

  for (const logsDir of candidates) {
    try {
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
      if (fs.existsSync(logsDir)) {
        return logsDir;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function getTelemetryApiKey(options = {}) {
  const envDir = options.envDir || _envDir || process.env.JIRA_ENV_DIR;

  if (envDir) {
    const envPath = path.resolve(envDir, ".env");
    const envDirEnv = readDotEnvFile(envPath);
    if (envDirEnv.TELEMETRY_API_KEY) {
      return envDirEnv.TELEMETRY_API_KEY;
    }
  }

  if (process.env.TELEMETRY_API_KEY) {
    return process.env.TELEMETRY_API_KEY;
  }

  return null;
}

async function sendToTelemetryApi(logPayload, apiKey, options = {}) {
  const apiUrl = getTelemetryApiUrl(options);
  const errors = {};
  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(logPayload)
    });

    if (!response.ok) {
      errors.api = `${response.status} ${response.statusText}`;
    }
  } catch (err) {
    errors.api = err.message;
  }
  return errors;
}

async function saveLog(logPayload, options = {}) {
  if (_skipLog) {
    return null;
  }

  const payloadToSave = shouldSimplifyLogPayload(options) ? simplifyLogPayload(logPayload) : logPayload;
  const errors = {};

  const logsDir = getLogPayloadsDir();
  if (logsDir) {
    const todayDate = formatDateForFilename(new Date());
    const dateDir = path.join(logsDir, todayDate);

    try {
      if (!fs.existsSync(dateDir)) {
        fs.mkdirSync(dateDir, { recursive: true });
      }
      const timestamp = formatDateTimeForFilename(new Date());
      const filename = `${timestamp}-${payloadToSave.command.replace(/ /g, "-")}.json`;
      const filepath = path.join(dateDir, filename);
      fs.writeFileSync(filepath, JSON.stringify(payloadToSave, null, 2));
    } catch (err) {
      errors.localSave = err.message;
    }
  } else {
    errors.localSave = "Unable to create log_payloads directory in CWD or home directory";
  }

  const apiKey = getTelemetryApiKey(options);
  if (apiKey) {
    const apiErrors = await sendToTelemetryApi(payloadToSave, apiKey, options);
    Object.assign(errors, apiErrors);
  }

  return Object.keys(errors).length > 0 ? errors : null;
}

function extractInputFlags(args, command) {
  const flags = {};

  const readOnlyFlags = {
    "me": ["assigned", "reported", "watched", "recent", "start-at", "max-results", "with-comments", "with-transitions", "with-assignable", "with-worklogs", "with-attachments", "explain"],
    "project search": ["query", "start-at", "max-results", "with-components", "operation-mode", "explain"],
    "issue search": ["issue-key", "jql", "start-at", "max-results", "with-comments", "with-transitions", "with-assignable", "with-worklogs", "with-attachments", "operation-mode", "explain"],
  };

  const createFlags = [
    "operation-mode",
    "project-id", "project-key", "project-query",
    "issue-type-id", "issue-type-name",
    "summary", "description",
    "labels",
    "worklog-time-spent", "worklog-comment", "worklog-started",
    "attach-file",
    "link-type", "link-issue",
    "start-date", "due-date",
    "priority-id",
    "component-ids",
    "parent-key", "parent-id",
    "environment-value", "environment-field-id",
    "story-points", "story-points-field-id",
    "original-estimate",
    "acceptance-value", "acceptance-field-id",
    "assignee-id",
    "incident-report", "bug-triage", "change-request", "release-blocker",
    "get-details",
  ];

  const addFlags = [
    "issue",
    "comment-body",
    "worklog-time-spent", "worklog-comment", "worklog-started",
    "attach-file",
    "link-type", "link-issue",
    "operation-mode",
    "get-details",
  ];

  const replaceFlags = [
    "issue",
    "summary", "description",
    "start-date", "due-date",
    "priority-id",
    "component-ids",
    "parent-key", "parent-id",
    "environment-value", "environment-field-id",
    "story-points", "story-points-field-id",
    "original-estimate",
    "acceptance-value", "acceptance-field-id",
    "assignee-id",
    "transition-id",
    "labels-add", "labels-remove",
    "operation-mode",
    "patch-mode", "patch-field",
    "get-details",
  ];

  const excludedFlags = ["human-approval-obtained", "yes", "preview-ref", "idempotency-key", "env-dir", "format"];

  let relevantFlags;
  if (readOnlyFlags[command]) {
    relevantFlags = readOnlyFlags[command];
  } else if (command === "issue create") {
    relevantFlags = createFlags;
  } else if (command === "issue edit add") {
    relevantFlags = addFlags;
  } else if (command === "issue edit replace") {
    relevantFlags = replaceFlags;
  } else {
    return flags;
  }

  for (const flag of relevantFlags) {
    if (args[flag] !== undefined && !excludedFlags.includes(flag)) {
      flags[flag] = args[flag];
    }
  }

  return flags;
}

module.exports = {
  saveLog,
  setEnvDir,
  skipLog,
  isSkipLog,
  setRawLogs,
  isRawLogs,
  shouldSimplifyLogPayload,
  extractInputFlags,
  simplifyLogPayload,
  getTelemetryApiKey,
};
