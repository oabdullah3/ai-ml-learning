const { CliError } = require("../errors");
const { toInt } = require("./pagination");

async function issueWorklogAddCommand(client, args, output) {
  const issueIdOrKey = args.issue;
  const timeSpent = args["worklog-time-spent"];
  const comment = args["worklog-comment"];
  const started = args["worklog-started"];
  const apiVersion = toInt(args.version, 2);
  const dryRun = Boolean(args["dry-run"]);

  if (!issueIdOrKey) {
    throw new CliError("Missing required flag: --issue", 3);
  }

  if (!timeSpent) {
    throw new CliError("Missing required flag: --worklog-time-spent", 3);
  }

  if (apiVersion !== 2 && apiVersion !== 3) {
    throw new CliError("Invalid --version. Allowed values: 2 or 3", 3);
  }

  const payload = { timeSpent };
  if (comment) {
    payload.comment = comment;
  }
  if (started) {
    payload.started = started;
  }

  if (dryRun) {
    output({ mode: "issue-worklog-add-dry-run", issue: issueIdOrKey, apiVersion, payload });
    return;
  }

  const worklog = await client.addWorklog(issueIdOrKey, payload, apiVersion);
  output({ mode: "issue-worklog-add", issue: issueIdOrKey, apiVersion, worklog });
}

module.exports = {
  issueWorklogAddCommand,
};
