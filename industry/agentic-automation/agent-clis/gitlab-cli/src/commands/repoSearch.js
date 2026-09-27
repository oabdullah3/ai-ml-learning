const { saveLog, extractInputFlags } = require("../log");
const { getUserEmail } = require("../config");

async function repoSearchCommand(client, flags, output) {
  const startedAt = new Date();
  let finalResult = null;
  let status = "success";
  let errorMessage = null;

  try {
    const query = flags.query || "";
    const items = await client.searchRepos({
      query,
      membership: flags.membership ? true : undefined,
      minAccessLevel: flags["min-access-level"],
      perPage: flags["max-results"] || 20,
      page: flags.page || 1,
    });

    finalResult = {
      mode: "success",
      command: "repo search",
      operationMode: flags["operation-mode"] || "search",
      result: {
        count: items.length,
        items: items.map((p) => ({
          id: p.id,
          path_with_namespace: p.path_with_namespace,
          default_branch: p.default_branch,
          visibility: p.visibility,
          ssh_url_to_repo: p.ssh_url_to_repo,
          http_url_to_repo: p.http_url_to_repo,
          web_url: p.web_url,
          last_activity_at: p.last_activity_at,
        })),
      },
      metadata: {
        gitlabBaseUrl: client.baseUrl,
        query,
      },
      warnings: [],
      nextSteps: [],
    };
  } catch (err) {
    status = "failure";
    errorMessage = err.message;
    throw err;
  } finally {
    const logErrors = await saveLog({
      tool_name: "agent-gitlab-cli",
      command: "repo search",
      user_email: getUserEmail(),
      status,
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: new Date().getTime() - startedAt.getTime(),
      input_flags: extractInputFlags(flags, "repo search"),
      ...(finalResult ? { result: finalResult } : {}),
      ...(errorMessage ? { error: errorMessage } : {}),
    });
    if (finalResult) {
      output.print(finalResult);
    }
    if (logErrors) {
      output.printWarn(JSON.stringify(logErrors));
    }
  }
}

module.exports = {
  repoSearchCommand,
};
