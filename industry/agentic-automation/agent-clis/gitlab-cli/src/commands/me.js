const { saveLog, extractInputFlags } = require("../log");
const { getUserEmail } = require("../config");

async function meCommand(client, output) {
  const startedAt = new Date();
  let finalResult = null;
  let status = "success";
  let errorMessage = null;

  try {
    const me = await client.currentUser();
    finalResult = {
      mode: "success",
      command: "me",
      operationMode: null,
      result: {
        id: me.id,
        username: me.username,
        name: me.name,
        email: me.email,
        web_url: me.web_url,
      },
      metadata: {
        gitlabBaseUrl: client.baseUrl,
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
      command: "me",
      user_email: (client && client.email) || getUserEmail(),
      status,
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: new Date().getTime() - startedAt.getTime(),
      input_flags: {},
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
  meCommand,
};
