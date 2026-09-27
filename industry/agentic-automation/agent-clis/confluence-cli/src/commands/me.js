const { rejectUnknownFlags, toInt } = require("../utils");
const { saveLog } = require("../log");

async function meCommand(client, args, output) {
  rejectUnknownFlags(args, ["limit", "start", "recent-edits", "drafts", "saved"], "me");

  const startedAt = new Date();
  const userEmail = client.email;

  const inputFlags = {};
  if (args.limit) inputFlags.limit = args.limit;
  if (args.start) inputFlags.start = args.start;
  if (args["recent-edits"]) inputFlags["recent-edits"] = true;
  if (args.drafts) inputFlags.drafts = true;
  if (args.saved) inputFlags.saved = true;

  let status = "success";
  let result = {};
  let error = null;
  let logErrors = null;

  try {
    const limit = toInt(args.limit, 10);
    const start = toInt(args.start, 0);
    const profile = await client.getMyself();

    result = {
      mode: "me",
      profile: {
        accountId: profile.accountId,
        displayName: profile.displayName,
        email: profile.email,
      },
    };

    if (args["recent-edits"]) {
      const cql = "lastModifier = currentUser() AND type = 'page' order by lastmodified desc";
      const data = await client.searchPagesCql(cql, limit, start);
      result.recentEdits = formatCqlResults(data.results || []);
    }

    if (args.drafts) {
      const drafts = await client.getMyDrafts(limit + start);
      // The /content?status=draft endpoint already returns only current user's drafts
      // Apply pagination client-side
      const paginatedDrafts = drafts.slice(start, start + limit);

      result.drafts = paginatedDrafts.map(p => ({
        id: p.id,
        title: p.title,
        spaceKey: p.space?.key || "Unknown",
        url: p._links?.webui || p._links?.self,
      }));
    }

    if (args.saved) {
      const cql = "favourite = currentUser() AND type = 'page' order by lastmodified desc";
      const data = await client.searchPagesCql(cql, limit, start);
      result.savedPages = formatCqlResults(data.results || []);
    }

    // output(result);
  } catch (err) {
    status = "failure";
    error = err.message;
    result = {};
    throw err;
  } finally {
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();

    const logPayload = {
      tool_name: "agent-confluence-cli",
      command: "me",
      user_email: userEmail,
      status,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: durationMs,
      input_flags: inputFlags,
      result,
      metadata: {},
      error
    };

    logErrors = await saveLog(logPayload);

    if (status === "success") {
      if (logErrors) {
        result.logErrors = logErrors;
      }
      output(result);
    }
  }
}

function formatCqlResults(results) {
  return results.map(p => ({
    id: p.content?.id || p.id,
    title: p.content?.title || p.title,
    spaceKey: p.resultGlobalContainer?.displayUrl?.split('/')[2] || "Unknown",
    url: p._links?.webui || p.url,
  }));
}

module.exports = { meCommand };