const CANONICAL_COMMANDS = [
  { key: "doctor credentials", usage: "agent-gitlab-cli doctor credentials [flags]" },
  { key: "repo search", usage: "agent-gitlab-cli repo search [flags]" },
  { key: "repo clone", usage: "agent-gitlab-cli repo clone [flags] [--fresh]" },
  { key: "repo status", usage: "agent-gitlab-cli repo status [flags]" },
  { key: "repo commit", usage: "agent-gitlab-cli repo commit [flags]" },
  { key: "repo push", usage: "agent-gitlab-cli repo push [flags]" },
  { key: "repo file search", usage: "agent-gitlab-cli repo file search [flags]" },
  { key: "repo file read", usage: "agent-gitlab-cli repo file read [flags]" },
  { key: "repo branch list", usage: "agent-gitlab-cli repo branch list [flags]" },
  { key: "repo branch create", usage: "agent-gitlab-cli repo branch create [flags]" },
  { key: "repo change apply", usage: "agent-gitlab-cli repo change apply [flags]" },
  { key: "repo mr list", usage: "agent-gitlab-cli repo mr list [flags]" },
  { key: "repo mr show", usage: "agent-gitlab-cli repo mr show [flags]" },
  { key: "repo mr diff", usage: "agent-gitlab-cli repo mr diff [flags]" },
  { key: "repo mr create", usage: "agent-gitlab-cli repo mr create [flags]" },
  { key: "me", usage: "agent-gitlab-cli me [flags]" },
];

function resolveCommandKey(positionals) {
  const key3 = positionals.slice(0, 3).join(" ");
  const key2 = positionals.slice(0, 2).join(" ");
  const key1 = positionals[0] || "";

  const canonical = new Set(CANONICAL_COMMANDS.map((c) => c.key));
  if (canonical.has(key3)) return key3;
  if (canonical.has(key2)) return key2;
  if (canonical.has(key1)) return key1;

  return key3 || key2 || key1;
}

module.exports = {
  CANONICAL_COMMANDS,
  resolveCommandKey,
};
