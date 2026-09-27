const path = require("path");
const { version } = require("../package.json");
const { createOutput } = require("./utils/output");
const { CliError, buildJsonError } = require("./utils/errors");
const { loadCredentials, resolveGitTlsEnv, setUserEmail } = require("./config");
const { GitLabClient, normalizeBaseUrl } = require("./gitlabClient");
const { resolveCommandKey } = require("./commandMatrix");
const { setEnvDir, skipLog } = require("./log");

const { doctorCredentialsCommand } = require("./commands/doctorCredentials");
const { repoSearchCommand } = require("./commands/repoSearch");
const { repoCloneCommand } = require("./commands/repoClone");
const { repoStatusCommand } = require("./commands/repoStatus");
const { repoCommitCommand } = require("./commands/repoCommit");
const { repoPushCommand } = require("./commands/repoPush");
const { repoFileSearchCommand } = require("./commands/repoFileSearch");
const { repoFileReadCommand } = require("./commands/repoFileRead");
const { repoBranchListCommand, repoBranchCreateCommand } = require("./commands/repoBranch");
const { repoChangeApplyCommand } = require("./commands/repoChangeApply");
const { repoMrListCommand, repoMrShowCommand, repoMrDiffCommand, repoMrCreateCommand } = require("./commands/repoMr");
const { meCommand } = require("./commands/me");

function parseArgv(argv) {
  const positionals = [];
  const flags = {};

  function setFlag(k, v) {
    if (flags[k] === undefined) {
      flags[k] = v;
      return;
    }
    if (Array.isArray(flags[k])) {
      flags[k].push(v);
      return;
    }
    flags[k] = [flags[k], v];
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    if (token === "--help" || token === "-h") {
      return { help: true, positionals, flags };
    }

    if (token === "--version" || token === "-v") {
      return { version: true, positionals, flags };
    }

    const eq = token.indexOf("=");
    if (eq > -1) {
      setFlag(token.slice(2, eq), normalizeValue(token.slice(eq + 1)));
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      setFlag(key, true);
      continue;
    }

    setFlag(key, normalizeValue(next));
    i += 1;
  }

  return { help: false, version: false, positionals, flags };
}

function normalizeValue(v) {
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

function printHelp() {
  const lines = [
    `Deterministic GitLab CLI for AI agents (v${version})`,
    "",
    "Usage:",
    "  agent-gitlab-cli doctor credentials [flags]",
    "  agent-gitlab-cli repo search [flags]",
    "  agent-gitlab-cli repo clone [flags]",
    "  agent-gitlab-cli repo status [flags]",
    "  agent-gitlab-cli repo commit [flags]",
    "  agent-gitlab-cli repo push [flags]",
    "  agent-gitlab-cli repo file search [flags]",
    "  agent-gitlab-cli repo file read [flags]",
    "  agent-gitlab-cli repo branch list [flags]",
    "  agent-gitlab-cli repo branch create [flags]",
    "  agent-gitlab-cli repo change apply [flags]",
    "  agent-gitlab-cli repo mr list [flags]",
    "  agent-gitlab-cli repo mr show [flags]",
    "  agent-gitlab-cli repo mr diff [flags]",
    "  agent-gitlab-cli repo mr create [flags]",
    "  agent-gitlab-cli me [flags]",
    "",
    "Global flags:",
    "  --format <json|text>          Output format (default text)",
    "  --gitlab-base-url <url>       Runtime GitLab base URL (required except doctor credentials)",
    "  --env-dir <path>              Directory containing .env credential file",
    "  --clone-root <path>           Clone root override",
    "  Environment: GITLAB_ENV_PATH points to a .env file",
    "",
    "repo selector flags (interchangeable where applicable):",
    "  --repo-id <id>",
    "  --repo-path <group/project>",
    "  --repo-url <url>",
    "  --query <text>",
    "  --path <dir>                 Optional repository path prefix for file search/tree",
    "  --file-path <path>           Repository file path for file read/change actions",
    "  --ref <name>                 Branch/tag/sha reference",
    "  --branch <name>              Branch for change apply mutations",
    "  --branch-name <name>         Branch name for branch create",
    "  --from-ref <ref>             Source ref for new branch (default repo default branch)",
    "  --action <create|update|delete>  Single file action for change apply",
    "  --actions-json <json|path>   JSON array (or file path) of commit actions",
    "  --content <text>             Content for create/update action",
    "  --message <text>             Commit message for change apply",
    "  --mr-iid <iid>               Merge request IID",
    "  --source-branch <name>       Merge request source branch",
    "  --target-branch <name>       Merge request target branch",
    "  --title <text>               Merge request title",
    "  --description <text>         Merge request description",
    "  --draft <true|false>         Whether MR is created as draft (default true)",
    "",
    "Mutation staged flags:",
    "  --operation-mode <prepare|show-changes|finalize>",
    "  --preview-token <token>",
    "  --human-approval-obtained",
    "  --idempotency-key <key>",
    "",
    "repo commit flags:",
    "  --repo-dir <path>             Existing repo directory",
    "  --message <text>              Commit message",
    "  --stage-all                   Stage all tracked/untracked changes before finalize",
    "",
    "repo push flags:",
    "  --repo-dir <path>             Existing repo directory",
    "  --remote <name>               Remote name (default origin)",
    "",
    "Examples:",
    "  agent-gitlab-cli repo search --gitlab-base-url https://gitlab.com --query platform --format json",
    "  agent-gitlab-cli repo clone --gitlab-base-url https://gitlab.com --repo-path group/project --format json",
    "  agent-gitlab-cli repo commit --gitlab-base-url https://gitlab.com --repo-path group/project --message \"Fix\" --operation-mode show-changes --format json",
    "  agent-gitlab-cli repo file search --gitlab-base-url https://gitlab.com --repo-path group/project --query README --format json",
    "  agent-gitlab-cli repo file read --gitlab-base-url https://gitlab.com --repo-path group/project --file-path README.md --ref main --format json",
    "  agent-gitlab-cli repo change apply --gitlab-base-url https://gitlab.com --repo-path group/project --branch feat-x --action update --file-path README.md --content \"new\" --message \"docs: update\" --operation-mode show-changes --format json",
    "  agent-gitlab-cli repo mr create --gitlab-base-url https://gitlab.com --repo-path group/project --source-branch feat-x --target-branch main --title \"feat: x\" --operation-mode show-changes --format json",
  ];

  process.stdout.write(`${lines.join("\n")}\n`);
}

function buildContext(flags) {
  const invocationCwd = process.cwd();
  const runtimeBaseUrl = normalizeBaseUrl(flags["gitlab-base-url"]);
  return {
    invocationCwd,
    runtimeBaseUrl,
    workspaceParent: path.dirname(invocationCwd),
  };
}

function ensureGitLabClient(commandKey, flags, context, preloadedCreds = null) {
  if (commandKey === "doctor credentials") return null;

  const creds = preloadedCreds || loadCredentials(flags, context.invocationCwd);
  const token = creds.GITLAB_TOKEN;
  return new GitLabClient({ baseUrl: context.runtimeBaseUrl, token });
}

async function run(argv) {
  const parsed = parseArgv(argv);
  setEnvDir(parsed.flags["env-dir"]);

  if (parsed.version) {
    skipLog();
    process.stdout.write(`${version}\n`);
    return;
  }

  if (parsed.help || parsed.positionals.length === 0) {
    skipLog();
    printHelp();
    return;
  }

  const output = createOutput(parsed.flags.format);
  const context = buildContext(parsed.flags);
  const commandKey = resolveCommandKey(parsed.positionals);

  if (commandKey === "unknown-command") {
    skipLog();
    throw new CliError(`Unknown command '${parsed.positionals.join(" ")}'. Run 'agent-gitlab-cli --help'.`, 2, {
      code: "UNKNOWN_COMMAND",
      category: "validation",
      remediation: "Use canonical command families only.",
    });
  }

  try {
    let creds = null;
    if (commandKey !== "doctor credentials") {
      creds = loadCredentials(parsed.flags, context.invocationCwd);
      context.gitEnv = resolveGitTlsEnv(creds, context.invocationCwd);
      context.flags = parsed.flags;
    }

    const client = ensureGitLabClient(commandKey, parsed.flags, context, creds);

    // Resolve user email once per invocation for accurate log payloads
    if (client) {
      try {
        const user = await client.currentUser();
        if (user && user.email) {
          setUserEmail(user.email);
        }
      } catch (_) {
        // Best-effort — logs will fall back to GITLAB_USERNAME
      }
    }

    switch (commandKey) {
      case "doctor credentials":
        await doctorCredentialsCommand(parsed.flags, output, context);
        return;
      case "repo search":
        await repoSearchCommand(client, parsed.flags, output, context);
        return;
      case "repo clone":
        await repoCloneCommand(client, parsed.flags, output, context);
        return;
      case "repo status":
        await repoStatusCommand(parsed.flags, output, context);
        return;
      case "repo commit":
        await repoCommitCommand(parsed.flags, output, context);
        return;
      case "repo push":
        await repoPushCommand(parsed.flags, output, context);
        return;
      case "repo file search":
        await repoFileSearchCommand(client, parsed.flags, output, context);
        return;
      case "repo file read":
        await repoFileReadCommand(client, parsed.flags, output, context);
        return;
      case "repo branch list":
        await repoBranchListCommand(client, parsed.flags, output, context);
        return;
      case "repo branch create":
        await repoBranchCreateCommand(client, parsed.flags, output, context);
        return;
      case "repo change apply":
        await repoChangeApplyCommand(client, parsed.flags, output, context);
        return;
      case "repo mr list":
        await repoMrListCommand(client, parsed.flags, output, context);
        return;
      case "repo mr show":
        await repoMrShowCommand(client, parsed.flags, output, context);
        return;
      case "repo mr diff":
        await repoMrDiffCommand(client, parsed.flags, output, context);
        return;
      case "repo mr create":
        await repoMrCreateCommand(client, parsed.flags, output, context);
        return;
      case "me":
        await meCommand(client, output, context);
        return;
    }
  } catch (err) {
    if (!output.jsonMode) {
      throw err;
    }

    const wrapped = err instanceof CliError ? err : new CliError(err.message || String(err), 1);
    output.print(buildJsonError(wrapped, commandKey, parsed.flags["operation-mode"] || null));
    if (wrapped.exitCode && wrapped.exitCode !== 0) {
      process.exitCode = wrapped.exitCode;
    }
  }
}

module.exports = {
  run,
};
