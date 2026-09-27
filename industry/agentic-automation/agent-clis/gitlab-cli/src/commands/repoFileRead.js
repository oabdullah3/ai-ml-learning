const { Buffer } = require("buffer");
const { requireFlag } = require("../utils/flagValidator");
const { requireResolvedRepo } = require("./repoResolve");
const { saveLog, extractInputFlags } = require("../log");
const { getUserEmail } = require("../config");

function decodeBase64(value) {
  if (!value) return "";
  try {
    return Buffer.from(String(value), "base64").toString("utf8");
  } catch (_) {
    return "";
  }
}

async function repoFileReadCommand(client, flags, output) {
  const startedAt = new Date();
  let finalResult = null;
  let status = "success";
  let errorMessage = null;

  try {
    requireFlag(flags, "file-path", "Missing --file-path for repo file read.");

    const repo = await requireResolvedRepo(client, flags, output, "repo file read", "read");
    if (!repo) return;

    const ref = flags.ref || repo.default_branch || "main";
    const file = await client.getFile({
      projectId: repo.id,
      filePath: flags["file-path"],
      ref,
    });

    const decoded = decodeBase64(file.content);
    const includeContent = !flags["content-only"] || flags["include-content"];

    finalResult = {
      mode: "success",
      command: "repo file read",
      operationMode: "read",
      result: {
        repo: {
          id: repo.id,
          path_with_namespace: repo.path_with_namespace,
        },
        file: {
          file_path: file.file_path,
          ref,
          size: file.size,
          encoding: file.encoding,
          content_sha256: file.content_sha256,
          last_commit_id: file.last_commit_id,
          execute_filemode: Boolean(file.execute_filemode),
        },
        ...(includeContent ? { content: decoded } : {}),
      },
      metadata: {
        gitlabBaseUrl: client.baseUrl,
      },
      warnings: includeContent ? [] : ["Content omitted; rerun with --include-content to include file body."],
      nextSteps: [],
    };
  } catch (err) {
    status = "failure";
    errorMessage = err.message;
    throw err;
  } finally {
    const logErrors = await saveLog({
      tool_name: "agent-gitlab-cli",
      command: "repo file read",
      user_email: getUserEmail(),
      status,
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: new Date().getTime() - startedAt.getTime(),
      input_flags: extractInputFlags(flags, "repo file read"),
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
  repoFileReadCommand,
};