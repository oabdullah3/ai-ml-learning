const { loadCredentials } = require("./config");
const { ConfluenceClient } = require("./confluenceClient");
const { CliError } = require("./errors");
const { meCommand } = require("./commands/me");
const { spaceSearchCommand } = require("./commands/spaceSearch");
const { pageSearchCommand } = require("./commands/pageSearch");
const { pageCreateCommand } = require("./commands/pageCreate");
const { pageEditContentCommand } = require("./commands/pageEditContent");
const { pageEditDetailsCommand } = require("./commands/pageEditDetails");
const { setEnvDir } = require("./log");
const { version } = require("../package.json");

const CANONICAL_COMMANDS = [
  { key: "space search", usage: "agent-confluence-cli space search [flags]" },
  { key: "page search", usage: "agent-confluence-cli page search [flags]" },
  { key: "page create", usage: "agent-confluence-cli page create [flags]" },
  { key: "page edit content", usage: "agent-confluence-cli page edit content [flags]" },
  { key: "page edit details", usage: "agent-confluence-cli page edit details [flags]" },
  { key: "me", usage: "agent-confluence-cli me [flags]" },
];

const COMMAND_HELP = {
  me: [
    "  --recent-edits             Append pages recently edited by you",
    "  --drafts                   Append your unpublished drafts",
    "  --saved                    Append your saved/starred pages",
    "  --limit <n>                Max items per category (default 10)",
    "  --start <n>                Pagination offset (default 0)",
  ],
  "space search": [
    "  --space-key <key>          INTERCHANGEABLE. Exact space key lookup",
    "  --query <text>             INTERCHANGEABLE. Search text",
    "  --with-description         Fetch space description",
    "  --with-homepage            Fetch homepage details",
    "  --with-permissions [l,s]   Fetch access rules",
    "  --with-labels [l,s]        Fetch labels",
    "  --limit <n>                Max items to return (default 10)",
    "  --start <n>                Pagination offset (default 0)",
  ],
  "page search": [
    "  --page-id <id>             INTERCHANGEABLE. Exact page ID lookup",
    "  --query <text>             INTERCHANGEABLE. Text search in page content",
    "  --title <text>             INTERCHANGEABLE. Text search in page title",
    "  --cql <query>              INTERCHANGEABLE. Raw CQL query",
    "  --space-key <key>          Narrow search to specific space",
    "  --label <name>             Filter by label (repeatable, AND semantics)",
    "  --ancestor-id <id>         Filter descendants under ancestor page ID",
    "  --ancestor-path <path>     Filter descendants under path (requires --space-key)",
    "  --created-from <iso>       Filter created date lower bound (inclusive)",
    "  --created-to <iso>         Filter created date upper bound (inclusive)",
    "  --updated-from <iso>       Filter updated date lower bound (inclusive)",
    "  --updated-to <iso>         Filter updated date upper bound (inclusive)",
    "  --with-content             Fetch page body",
    "  --body-format <format>     'storage', 'atlas_doc_format', or 'view' (default: view)",
    "  --with-labels [l,s]        Fetch page labels",
    "  --with-version-history [l,s] Fetch version history (lastUpdated)",
    "  --with-ancestors [l,s]     Fetch parent hierarchy",
    "  --with-children [l,s]      Fetch sub-pages",
    "  --with-attachments [l,s]   Fetch files",
    "  --with-comments [l,s]      Fetch comments",
    "  --with-restrictions        Fetch page locks",
    "  --limit <n>                Max items to return (default 10)",
    "  --start <n>                Pagination offset (default 0)",
  ],
  "page create": [
    "  --space-key <key>          INTERCHANGEABLE. Space key for page creation",
    "  --space-name <name>        INTERCHANGEABLE. Space name for page creation",
    "  --incident-report          Use incident report template preset",
    "  --meeting-notes            Use meeting notes template preset",
    "  --gap-analysis             Use gap analysis template preset",
    "  --risk-register            Use risk register template preset",
    "  --impact-analysis          Use impact analysis template preset",
    "  --change-request-form      Use change request template preset",
    "  --release-notes            Use release notes template preset",
    "  --title <text>             REQUIRED. Page title",
    "  --page-location <path>     Optional hierarchy path from space root (e.g. './Folder/Page/')",
    "  --operation-mode <mode>    'prepare', 'show-changes', or 'finalize' (default: prepare)",
    "  --pipe-changed             REQUIRED for show-changes stage",
    "  --human-approval-obtained  REQUIRED for finalize",
    "  Preset precedence: explicit space+location > explicit space root > preset destination > personal space root",
    "",
    "Examples:",
    "  agent-confluence-cli page create --space-key CH1 --title \"Test\" --operation-mode prepare",
    "  agent-confluence-cli page create --incident-report --title \"INC-2026-0042\" --operation-mode prepare",
    "  agent-confluence-cli page create --meeting-notes --space-key CH1 --page-location \"./Ops/Meetings/\" --title \"Meeting Notes\" --operation-mode prepare",
  ],
  "page edit content": [
    "  --page-id <id>             INTERCHANGEABLE. Exact page ID",
    "  --page-title <text>        INTERCHANGEABLE. Exact page title for lookup",
    "  --query <text>             INTERCHANGEABLE. Search query for page lookup",
    "  --cql <query>              INTERCHANGEABLE. Raw CQL query",
    "  --space-key <key>          Used with --page-title or --query to narrow search",
    "  --space-name <name>        Used with --page-title or --query to narrow search",
    "  --operation-mode <mode>    'resolve', 'prepare', 'show-changes', or 'finalize'",
    "  --pipe-changed             REQUIRED for show-changes stage",
    "  --pipe-file-written-to     Legacy alias for --pipe-changed",
    "  --inline-attachment-path   Upload file(s) first and return inline insertion marker(s)",
    "  --inline-comment           Enable inline comment markers in content workflow",
    "  --patch-scope <mode>       Optional targeted patch scope: heading|section",
    "  --target-heading <text>    Target heading for scoped patch (repeatable)",
    "  --patch-mode <mode>        Scoped patch mode: replace|append|prepend",
    "  --full-rewrite             Disable patch-first behavior and rewrite full content",
    "  --human-approval-obtained  REQUIRED for finalize",
    "  --pipe-dir <path>          Optional pipe directory or .confluence-pipe file path",
    "",
    "Examples:",
    "  agent-confluence-cli page edit content --page-id 123 --operation-mode show-changes --pipe-changed",
  ],
  "page edit details": [
    "  --page-id <id>             REQUIRED. Target page ID",
    "  --new-title <text>         Rename page title without changing body",
    "  --comment <text>           Add a new comment",
    "  --label <text>             Add label(s), comma-separated supported",
    "  --attachment-path <path>   Add attachment file(s), comma-separated supported",
    "  --operation-mode <mode>    'prepare' or 'finalize' (default: prepare)",
    "  --human-approval-obtained  REQUIRED for finalize",
    "  --pipe-dir <path>          Optional pipe directory or .confluence-pipe file path",
  ],
};

function buildCommandSummary() {
  return CANONICAL_COMMANDS.map((cmd) => `  ${cmd.usage}`).join("\n");
}

function buildGlobalHelpText() {
  const usageLines = buildCommandSummary();
  return [
    `Deterministic Confluence CLI for AI agents (v${version})`,
    "",
    "",
    "Usage:",
    usageLines,
    "",
    "Notes:",
    "  REQUIRED flags must be supplied.",
    "  INTERCHANGEABLE means choose exactly one flag from the group.",
    "  [l,s] denotes [limit,start] pagination tuples.",
    "  page edit content is patch-first by default (use --full-rewrite to override).",
    "  page create template preset flags preload .confluence-pipe from deterministic template source.",
    "",
    "Global flags:",
    "  --env-dir <path>           Directory containing .env with Confluence credentials",
    "  --config-path <path>       Path to openclaw.json config file",
    "  --format <json|text>       Output format (default text)",
    "",
    "Run each command with -h or --help to view all flags available for that command along with their descriptions.",
  ].join("\n");
}

function buildCommandHelpText(commandKey) {
  const usageLine = CANONICAL_COMMANDS.find((cmd) => cmd.key === commandKey)?.usage
    || `agent-confluence-cli ${commandKey}`;
  const flagLines = COMMAND_HELP[commandKey] || [];
  const lines = [
    `Usage: ${usageLine}`,
    "",
    "Notes:",
    "  REQUIRED flags must be supplied.",
    "  INTERCHANGEABLE means choose exactly one flag from the group.",
    "  [l,s] denotes [limit,start] pagination tuples.",
    ...(commandKey === "page edit content"
      ? ["  page edit content is patch-first by default (use --full-rewrite to override)."]
      : []),
    ...(commandKey === "page create"
      ? ["  page create template preset flags preload .confluence-pipe from deterministic template source."]
      : []),
    "",
    "Flags:",
    ...flagLines,
  ];
  return lines.join("\n");
}

async function run(argv) {
  const parsed = parseArgv(argv);

  if (parsed.positionals.length === 0 && !parsed.help) {
    process.stdout.write("Please provide at least one argument. Use -h or --help to view list of available commands.\n");
    return;
  }

  if (parsed.help && parsed.positionals.length === 0) {
    process.stdout.write(buildGlobalHelpText() + "\n");
    return;
  }

  const commandKey = resolveCommandKey(parsed.positionals);

  if (parsed.help) {
    const commandKnown = CANONICAL_COMMANDS.some((cmd) => cmd.key === commandKey);
    if (!commandKnown) {
      throw new CliError(
        `Unknown command '${commandKey}'. Run 'agent-confluence-cli --help' for usage.`,
        2
      );
    }

    process.stdout.write(buildCommandHelpText(commandKey) + "\n");
    return;
  }

  // Set envDir for telemetry key resolution (used by saveLog in commands)
  setEnvDir(parsed.flags["env-dir"]);

  const credentials = loadCredentials({
    configPath: parsed.flags["config-path"],
    envDir: parsed.flags["env-dir"],
  });

  const client = new ConfluenceClient(credentials);
  const output = createOutput(parsed.flags.format);

  switch (commandKey) {
    case "space search":
      await spaceSearchCommand(client, parsed.flags, output);
      return;
    case "page search":
      await pageSearchCommand(client, parsed.flags, output);
      return;
    case "page create":
      await pageCreateCommand(client, parsed.flags, output);
      return;
    case "page edit content":
      await pageEditContentCommand(client, parsed.flags, output);
      return;
    case "page edit details":
      await pageEditDetailsCommand(client, parsed.flags, output);
      return;
    case "me":
      await meCommand(client, parsed.flags, output);
      return;
    default:
      if (parsed.positionals[0] === "me" && parsed.positionals.length === 1) {
        await meCommand(client, parsed.flags, output);
        return;
      }
      throw new CliError(`Unknown command '${commandKey}'. Run 'agent-confluence-cli --help' for usage.`, 2);
  }
}

function resolveCommandKey(positionals) {
  if (positionals[0] === "page" && positionals[1] === "edit" && positionals[2]) {
    return `page edit ${positionals[2]}`;
  }

  const key2 = positionals.slice(0, 2).join(" ");
  const key1 = positionals[0] || "";
  const canonicalSet = new Set(CANONICAL_COMMANDS.map((cmd) => cmd.key));

  if (canonicalSet.has(key2)) {
    return key2;
  }
  if (canonicalSet.has(key1)) {
    return key1;
  }
  return key2 || key1;
}

function parseArgv(argv) {
  const positionals = [];
  const flags = {};
  let helpRequested = false;

  function setFlagValue(key, value) {
    if (typeof flags[key] === "undefined") {
      flags[key] = value;
      return;
    }

    if (Array.isArray(flags[key])) {
      flags[key].push(value);
      return;
    }

    flags[key] = [flags[key], value];
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "-h" || token === "--help") {
      helpRequested = true;
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
      setFlagValue(key, normalizeFlagValue(value));
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      setFlagValue(key, true);
      continue;
    }

    setFlagValue(key, normalizeFlagValue(next));
    i += 1;
  }

  return { help: helpRequested, positionals, flags };
}

function normalizeFlagValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function createOutput(format) {
  const mode = format === "json" ? "json" : "text";
  return (payload) => {
    if (mode === "json") {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return;
    }
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  };
}

module.exports = { run };