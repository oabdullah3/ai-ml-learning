const { loadCredentials } = require("./config");
const { JiraClient } = require("./jiraClient");
const { CliError } = require("./errors");
const { version } = require("../package.json");
const {
  CANONICAL_COMMANDS,
  LEGACY_COMMAND_MIGRATIONS,
  resolveCommandKey,
} = require("./commandMatrix");
const { setEnvDir, skipLog, setRawLogs } = require("./log");
const { projectSearchCommand } = require("./commands/projectSearch");
const { issueSearchCommand } = require("./commands/issueSearch");
const { issueCreateCommand } = require("./commands/issueCreate");
const { issueEditAddCommand } = require("./commands/issueEditAdd");
const { issueEditReplaceCommand } = require("./commands/issueEditReplace");
const { meCommand } = require("./commands/me");
const { doctorCredentialsCommand } = require("./commands/doctorCredentials");

const COMMAND_CONFIG = {
  "project search": { fn: projectSearchCommand, requiresAuth: true },
  "issue search": { fn: issueSearchCommand, requiresAuth: true },
  "issue create": { fn: issueCreateCommand, requiresAuth: true },
  "issue edit add": { fn: issueEditAddCommand, requiresAuth: true },
  "issue edit replace": { fn: issueEditReplaceCommand, requiresAuth: true },
  me: { fn: meCommand, requiresAuth: true },
  "doctor credentials": { fn: doctorCredentialsCommand, requiresAuth: false },
};

const COMMAND_HELP = {
  "doctor credentials": [
    "  --env-dir <path>           Optional credential source probe path (<path>/.env)",
    "  --format <json|text>       Output format (default text)",
  ],
  me: [
    "  --assigned                 Append issues currently assigned to you",
    "  --reported                 Append issues reported by you",
    "  --watched                  Append issues watched by you",
    "  --recent                   Append issues recently viewed by you",
    "  --start-at <n>             Pagination offset per selected me category (default 0)",
    "  --max-results <n>          Max issues to return per category (default 20)",
    "  --with-comments [m,s]      Optional deep comments enrichment tuple [max,start]",
    "  --with-transitions [m,s]   Optional deep transitions enrichment tuple [max,start]",
    "  --with-assignable [m,s]    Optional deep assignable-users enrichment tuple [max,start]",
    "  --with-worklogs [m,s]      Optional deep worklogs enrichment tuple [max,start]",
    "  --with-attachments [m,s]   Optional deep attachments enrichment tuple [max,start]",
    "  --explain                  Include explain block (selectors/query/enrichment/pagination/fallback)",
  ],
  "project search": [
    "  --query <text>             REQUIRED. Project search text",
    "  --operation-mode <search>  Search mode (default search)",
    "  --max-results <n>          Max projects to return (default 50)",
    "  --start-at <n>             Pagination offset (default 0)",
    "  --with-components          Include project components in output",
    "  --explain                  Include explain block (selectors/query/enrichment/pagination/fallback)",
  ],
  "issue search": [
    "  --jql <query>              REQUIRED unless --issue-key is used",
    "  --issue-key <key>          Directly fetch full details for specific issue key",
    "  --operation-mode <search>  Search mode (default search)",
    "  --start-at <n>             Pagination offset for JQL search results (default 0)",
    "  --max-results <n>          Max issues to return (default 50)",
    "  --with-comments [m,s]      Fetch comments tuple [max,start] when one issue is isolated",
    "  --with-transitions [m,s]   Fetch transitions tuple [max,start] when one issue is isolated",
    "  --with-assignable [m,s]    Fetch assignable-users tuple [max,start] when one issue is isolated",
    "  --with-worklogs [m,s]      Fetch worklogs tuple [max,start] when one issue is isolated",
    "  --with-attachments [m,s]   Fetch attachments tuple [max,start] when one issue is isolated",
    "  --explain                  Include explain block (selectors/query/enrichment/pagination/fallback)",
  ],
  "issue create": [
    "  --operation-mode <prepare|show-changes|finalize>  Mutation workflow mode (default show-changes)",
    "  --project-id <id> | --project-key <key> | --project-query <name>",
    "  --issue-type-id <id> | --issue-type-name <name>",
    "  --summary <text>           REQUIRED. Issue summary",
    "  --description <text>       Optional description text",
    "  --incident-report          Apply incident-report create preset",
    "  --bug-triage               Apply bug-triage create preset",
    "  --change-request           Apply change-request create preset",
    "  --release-blocker          Apply release-blocker create preset",
    "  --priority-id <id>         Post-create: set issue priority by id",
    "  --component-ids <csv>      Post-create: replace components by ids",
    "  --parent-key <key>         Post-create: set parent by issue key",
    "  --parent-id <id>           Post-create: set parent by issue id",
    "  --environment-value <text> Post-create: set environment field value",
    "  --environment-field-id <id> Optional environment field override (customfield_* or environment)",
    "  --story-points <number>    Post-create: set story points",
    "  --story-points-field-id <id> Optional story points field override (customfield_*)",
    "  --original-estimate <dur>  Post-create: set original estimate (Jira duration)",
    "  Note: start-date auto-resolves from editmeta field-name mapping; due-date uses Jira due date field.",
    "  --start-date <YYYY-MM-DD>  Post-create: set start date",
    "  --due-date <YYYY-MM-DD>    Post-create: set due date",
    "  --comment-body <text>      Post-create: add a comment",
    "  --labels <text>            Post-create: comma-separated list of labels",
    "  --worklog-time-spent <v>   Post-create: add worklog",
    "  --worklog-comment <text>      Post-create: worklog comment (requires --worklog-time-spent)",
    "  --worklog-started <ISO8601>   Post-create: worklog started timestamp (requires --worklog-time-spent)",
    "  --acceptance-value <text>  Post-create: acceptance content",
    "  --acceptance-field-id <id> Optional acceptance field override (customfield_*)",
    "  --attach-file <path>       Post-create: upload attachment",
    "  --assignee-id <id>         Post-create: set assignee by accountId",
    "  --link-type <name>         Post-create: issue link type (requires --link-issue)",
    "  --link-issue <key>         Post-create: issue link target (requires --link-type)",
    "  --get-details              Post-create: fetch full issue details",
  ],
  "issue edit add": [
    "  --operation-mode <prepare|show-changes|finalize> Mutation workflow mode (default show-changes)",
    "  --issue <key>              REQUIRED. Jira issue key or id",
    "  --comment-body <text>      Add a comment to the issue",
    "  --labels <text>            Comma-separated labels to append",
    "  --worklog-time-spent <v>   Add worklog entry",
    "  --worklog-comment <text>      Worklog comment (requires --worklog-time-spent)",
    "  --worklog-started <ISO8601>   Worklog started timestamp (requires --worklog-time-spent)",
    "  --attach-file <path>       Upload attachment",
    "  --link-type <name>         Issue link type (requires --link-issue)",
    "  --link-issue <key>         Issue link target (requires --link-type)",
    "  --get-details              Post-finalize: fetch full issue details",
  ],
  "issue edit replace": [
    "  --operation-mode <prepare|show-changes|finalize> Mutation workflow mode (default show-changes)",
    "  --issue <key>              REQUIRED. Jira issue key or id",
    "  --summary <text>           Replace summary",
    "  --description <text>       Replace full description",
    "  --issue-type-id <id>       Replace issue type by id",
    "  --issue-type-name <name>   Replace issue type by name",
    "  --patch-mode <mode>        Description/acceptance patch mode: replace|append|prepend (default: replace)",
    "  --patch-field <field>      Patch target scope: description|acceptance|both|all (default: description,acceptance)",
    "  --labels-add <text>        Surgical: Comma-separated labels to append",
    "  --labels-remove <text>     Surgical: Comma-separated labels to remove",
    "  --start-date <YYYY-MM-DD>  Set start date",
    "  --due-date <YYYY-MM-DD>    Set due date",
    "  --priority-id <id>         Set issue priority by id",
    "  --component-ids <csv>      Replace components by ids",
    "  --parent-key <key>         Set parent by issue key",
    "  --parent-id <id>           Set parent by issue id",
    "  --environment-value <text> Set environment field value",
    "  --environment-field-id <id> Optional environment field override (customfield_* or environment)",
    "  --story-points <number>    Set story points",
    "  --story-points-field-id <id> Optional story points field override (customfield_*)",
    "  --original-estimate <dur>  Set original estimate (Jira duration)",
    "  Note: start-date auto-resolves from editmeta field-name mapping; due-date uses Jira due date field.",
    "  --acceptance-value <text>  Replace acceptance criteria content",
    "  --acceptance-field-id <id> Optional acceptance field override (customfield_*)",
    "  --assignee-id <id>         Set assignee by accountId",
    "  --transition-id <id>       Execute workflow transition",
    "  --get-details              Post-finalize: fetch full issue details",
    "  Note: --dry-run removed. Use --operation-mode prepare or show-changes.",
  ],
};

function buildCommandSummary() {
  return CANONICAL_COMMANDS.map((cmd) => `  ${cmd.usage}`).join("\n");
}

function buildGlobalHelpText() {
  const usageLines = buildCommandSummary();
  return [
    `Deterministic Jira CLI for AI agents v${version}`,
    "",
    "",
    "Usage:",
    usageLines,
    "",
    "Global flags:",
    "  --env-dir <path>           Directory containing .env with Jira credentials",
    "  --format <json|text>       Output format (default text)",
    "  --raw-logs                 Store/send full log payloads instead of simplified summaries",
    "  Note: doctor credentials is read-only and does not require valid Jira auth.",
    "",
    `Run each command with -h or --help to view all flags available for that command along with their descriptions.`,
  ].join("\n");
}

function buildCommandHelpText(commandKey) {
  const usageLine = CANONICAL_COMMANDS.find((cmd) => cmd.key === commandKey)?.usage || `agent-jira-cli ${commandKey}`;
  const flagLines = COMMAND_HELP[commandKey] || [];
  const lines = [
    `Usage: ${usageLine}`,
    "",
    "Flags:",
    ...flagLines,
  ];
  return lines.join("\n");
}

async function run(argv) {
  const parsed = parseArgv(argv);

  if (parsed.version) {
    skipLog();
    process.stdout.write(`${version}\n`);
    return;
  }

  if (parsed.positionals.length === 0 && !parsed.help) {
    process.stdout.write("Please provide at least one argument. Use -h or --help to view list of available commands.\n");
    return;
  }

  if (parsed.help && parsed.positionals.length === 0) {
    skipLog();
    process.stdout.write(buildGlobalHelpText() + "\n");
    return;
  }

  const resolvedCommand = resolveCommandKey(parsed.positionals);

  if (parsed.help) {
    const migration = LEGACY_COMMAND_MIGRATIONS[resolvedCommand];
    if (migration) {
      skipLog();
      throw new CliError(
        `Command '${resolvedCommand}' is legacy and not supported. ${migration}`,
        3
      );
    }

    const commandConfig = COMMAND_CONFIG[resolvedCommand];
    if (!commandConfig) {
      skipLog();
      throw new CliError(
        `Unknown command '${resolvedCommand}'. Run 'agent-jira-cli --help' for usage.`,
        2
      );
    }

    skipLog();
    process.stdout.write(buildCommandHelpText(resolvedCommand) + "\n");
    return;
  }

  const migration = LEGACY_COMMAND_MIGRATIONS[resolvedCommand];
  if (migration) {
    throw new CliError(
      `Command '${resolvedCommand}' is legacy and not supported. ${migration}`,
      3
    );
  }

  const commandConfig = COMMAND_CONFIG[resolvedCommand];
  if (!commandConfig) {
    throw new CliError(
      `Unknown command '${resolvedCommand}'. Run 'agent-jira-cli --help' for usage.`,
      2
    );
  }

  if (parsed.flags["env-dir"]) {
    setEnvDir(parsed.flags["env-dir"]);
  }
  if (parsed.flags["raw-logs"] !== undefined) {
    setRawLogs(parsed.flags["raw-logs"]);
  }

  let client = null;
  if (commandConfig.requiresAuth) {
    const credentials = loadCredentials({
      envDir: parsed.flags["env-dir"],
    });
    client = new JiraClient(credentials);
  }

  const output = createOutput(parsed.flags.format, client);
  await commandConfig.fn(client, parsed.flags, output);
}

function parseArgv(argv) {
  const positionals = [];
  const flags = {};
  let helpRequested = false;
  let versionRequested = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "-h" || token === "--help") {
      helpRequested = true;
      continue;
    }

    if (token === "-v" || token === "--version") {
      versionRequested = true;
      continue;
    }

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const eq = token.indexOf("=");
    if (eq > -1) {
      const key = token.slice(2, eq);
      const value = token.slice(eq + 1);
      flags[key] = normalizeFlagValue(value);
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }

    flags[key] = normalizeFlagValue(next);
    i += 1;
  }

  return { help: helpRequested, version: versionRequested, positionals, flags };
}

function normalizeFlagValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function createOutput(format, client) {
  const mode = format === "json" ? "json" : "text";
  return (payload) => {
    const diagnostics = client && typeof client.consumeLastDiagnostics === "function"
      ? client.consumeLastDiagnostics()
      : null;
    const out = diagnostics ? { ...payload, diagnostics } : payload;

    if (mode === "json") {
      process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
      return;
    }
    process.stdout.write(renderText(out));
  };
}

function renderText(payload) {
  const lines = [];
  lines.push(`mode: ${payload.mode}`);

  if (payload.query) lines.push(`query: ${payload.query}`);
  if (payload.message) lines.push(`message: ${payload.message}`);
  if (typeof payload.total === "number") lines.push(`total: ${payload.total}`);
  if (payload.pagination) {
    lines.push("pagination:");
    lines.push(JSON.stringify(payload.pagination, null, 2));
  }
  if (payload.explain) {
    lines.push("explain:");
    lines.push(JSON.stringify(payload.explain, null, 2));
  }

  if (payload.profile) {
    lines.push("profile:");
    lines.push(`  name: ${payload.profile.displayName}`);
    lines.push(`  email: ${payload.profile.emailAddress || "N/A"}`);
    lines.push(`  accountId: ${payload.profile.accountId}`);

    const printList = (label, arr) => {
      if (arr) {
        lines.push(`  ${label} issues: ${arr.length}`);
        arr.forEach(i => lines.push(`    - ${i.key}: ${i.fields?.summary || i.summary || "(no summary)"}`));
      }
    };

    printList("assigned", payload.assigned);
    printList("reported", payload.reported);
    printList("watched", payload.watched);
    printList("recent", payload.recent);
  }

  if (payload.mode === "doctor-credentials") {
    lines.push(`selected-source: ${payload.selectedSource}`);
    lines.push("lookup-order:");
    for (const src of payload.lookupOrder || []) {
      lines.push(`- ${src}`);
    }
    lines.push("attempts:");
    for (const attempt of payload.attempts || []) {
      lines.push(`- source: ${attempt.source}`);
      if (attempt.envPath) lines.push(`  env-path: ${attempt.envPath}`);
      if (typeof attempt.exists === "boolean") lines.push(`  exists: ${attempt.exists}`);
      if (attempt.error) lines.push(`  error: ${attempt.error}`);
      if (attempt.keyPresence) {
        lines.push(`  keys: cloudId=${attempt.keyPresence.JIRA_CLOUD_ID} email=${attempt.keyPresence.JIRA_EMAIL} token=${attempt.keyPresence.JIRA_API_TOKEN}`);
      }
      if (Array.isArray(attempt.missingKeys) && attempt.missingKeys.length > 0) {
        lines.push(`  missing: ${attempt.missingKeys.join(", ")}`);
      }
    }
    if (Array.isArray(payload.remediation)) {
      lines.push("remediation:");
      for (const step of payload.remediation) {
        lines.push(`- ${step}`);
      }
    }
  }

  if (payload.projects) {
    lines.push("projects:");
    for (const project of payload.projects) {
      lines.push(`- ${project.key} (${project.id}) ${project.name || ""}`.trim());
      if (Array.isArray(project.issueTypes) && project.issueTypes.length > 0) {
        const types = project.issueTypes.map((t) => t?.name).filter(Boolean).join(", ");
        lines.push(`  issue-types: ${types}`);
      }
      if (Array.isArray(project.components) && project.components.length > 0) {
        const comps = project.components.map((c) => c?.name).filter(Boolean).join(", ");
        lines.push(`  components: ${comps}`);
      }
    }
  }

  if (payload.issues) {
    lines.push("issues:");
    for (const issue of payload.issues) {
      const summary = issue?.fields?.summary || issue?.summary || "(no summary)";
      lines.push(`- ${issue.key}: ${summary}`);
    }
  }

  if (payload.comments) {
    lines.push("comments:");
    for (const comment of payload.comments) {
      const author = comment?.author?.displayName || "unknown";
      const body = typeof comment?.body === "string" ? comment.body.slice(0, 50) : "doc";
      lines.push(`- ${author}: ${body}...`);
    }
  }

  if (payload.transitions) {
    lines.push("transitions:");
    for (const transition of payload.transitions) {
      lines.push(`- [${transition.id}] ${transition.name}`);
    }
  }

  if (payload.assignableUsers) {
    lines.push("assignable-users:");
    for (const user of payload.assignableUsers) {
      lines.push(`- ${user.displayName} (${user.accountId})`);
    }
  }

  if (payload.worklogs) {
    lines.push("worklogs:");
    for (const worklog of payload.worklogs) {
      lines.push(`- ${worklog.id || "(no-id)"}: ${worklog.timeSpent || "(no-time)"}`);
    }
  }

  if (payload.attachments) {
    lines.push("attachments:");
    for (const attachment of payload.attachments) {
      lines.push(`- ${attachment.filename || attachment.id || "(unnamed)"}`);
    }
  }

  if (payload.enrichmentPagination) {
    lines.push("enrichment-pagination:");
    lines.push(JSON.stringify(payload.enrichmentPagination, null, 2));
  }

  if (payload.issueTypes) {
    lines.push("issue-types:");
    for (const issueType of payload.issueTypes) {
      const name = issueType?.name || "(unnamed)";
      lines.push(`- ${issueType.id}: ${name}`);
    }
  }

  if (payload.fields) {
    lines.push("fields:");
    lines.push(JSON.stringify(payload.fields, null, 2));
  }

  if (payload.created) lines.push(`created: ${payload.created.key || JSON.stringify(payload.created)}`);
  if (payload.updated) {
    lines.push(`issue: ${payload.issue}`);
    lines.push(`updated: ${payload.updated}`);
  }
  if (payload.primaryResult) {
    lines.push("primary-result:");
    lines.push(JSON.stringify(payload.primaryResult, null, 2));
  }
  if (payload.actionResult) {
    lines.push("action-result:");
    lines.push(JSON.stringify(payload.actionResult, null, 2));
  }
  if (payload.changeSummary) {
    lines.push("change-summary:");
    lines.push(JSON.stringify(payload.changeSummary, null, 2));
  }
  if (payload.instruction) {
    lines.push("instruction:");
    lines.push(payload.instruction);
  }
  if (payload.issueData) {
    lines.push("issue-data:");
    lines.push(JSON.stringify(payload.issueData, null, 2));
  }
  if (payload.resolution) {
    lines.push("resolution:");
    lines.push(`  status: ${payload.resolution.status}`);
    lines.push(`  selector: ${JSON.stringify(payload.resolution.selector || {})}`);
    if (payload.resolution.selected) {
      lines.push(`  selected: ${JSON.stringify(payload.resolution.selected)}`);
    }
    if (Array.isArray(payload.resolution.candidates) && payload.resolution.candidates.length > 0) {
      lines.push(`  candidates: ${JSON.stringify(payload.resolution.candidates)}`);
    }
    if (payload.resolution.instruction) {
      lines.push(`  instruction: ${payload.resolution.instruction}`);
    }
  }
  if (payload.diagnostics && payload.diagnostics.retriesAttempted > 0) {
    lines.push("diagnostics:");
    lines.push(`  retries-attempted: ${payload.diagnostics.retriesAttempted}`);
    lines.push(`  retry-delay-ms: ${payload.diagnostics.retryDelayMs}`);
    if (payload.diagnostics.lastHttpStatus) {
      lines.push(`  last-http-status: ${payload.diagnostics.lastHttpStatus}`);
    }
    if (payload.diagnostics.requestId) {
      lines.push(`  request-id: ${payload.diagnostics.requestId}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

module.exports = {
  run,
};
