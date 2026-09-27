const CANONICAL_COMMANDS = [
  { key: "doctor credentials", usage: "agent-jira-cli doctor credentials [flags]" },
  { key: "project search", usage: "agent-jira-cli project search [flags]" },
  { key: "issue search", usage: "agent-jira-cli issue search [flags]" },
  { key: "issue create", usage: "agent-jira-cli issue create [flags]" },
  { key: "issue edit add", usage: "agent-jira-cli issue edit add [flags]" },
  { key: "issue edit replace", usage: "agent-jira-cli issue edit replace [flags]" },
  { key: "me", usage: "agent-jira-cli me [flags]" },
];

const LEGACY_COMMAND_MIGRATIONS = {
  "issue edit": "Use 'agent-jira-cli issue edit add' or 'agent-jira-cli issue edit replace'.",
  "issue-type list": "Use 'agent-jira-cli project search --query <text> --format json' and read project issueTypes.",
  "issue details": "Use 'agent-jira-cli issue search --issue-key <key> --format json'.",
  "issue comment add": "Use 'agent-jira-cli issue edit add --issue <key> --comment-body <text> --format json'.",
  "issue worklog add": "Use 'agent-jira-cli issue edit add --issue <key> --worklog-time-spent <value> --format json'.",
  "issue attachment upload": "Use 'agent-jira-cli issue edit add --issue <key> --attach-file <path> --format json'.",
  "issue dates": "Use 'agent-jira-cli issue edit replace --issue <key> --start-date <YYYY-MM-DD> and/or --due-date <YYYY-MM-DD> --format json'.",
  "issue acceptance": "Use 'agent-jira-cli issue edit replace --issue <key> --acceptance-value <text> --format json'.",
};

function resolveCommandKey(positionals) {
  const key3 = positionals.slice(0, 3).join(" ");
  const key2 = positionals.slice(0, 2).join(" ");
  const key1 = positionals[0] || "";

  const canonicalSet = new Set(CANONICAL_COMMANDS.map((cmd) => cmd.key));

  if (canonicalSet.has(key3)) {
    return key3;
  }
  if (canonicalSet.has(key2)) {
    return key2;
  }
  if (canonicalSet.has(key1)) {
    return key1;
  }
  if (LEGACY_COMMAND_MIGRATIONS[key3]) {
    return key3;
  }
  if (LEGACY_COMMAND_MIGRATIONS[key2]) {
    return key2;
  }
  if (LEGACY_COMMAND_MIGRATIONS[key1]) {
    return key1;
  }
  return key3 || key2 || key1;
}

module.exports = {
  CANONICAL_COMMANDS,
  LEGACY_COMMAND_MIGRATIONS,
  resolveCommandKey,
};
