const path = require("path");
const { runGit } = require("../utils/gitRunner");
const { resolveRepoTarget } = require("../utils/repoTarget");
const { resolveCloneRoot, resolveExistingRepo, determineTargetDir, rememberRepo } = require("../utils/repoIndex");
const { saveLog, extractInputFlags } = require("../log");
const { getUserEmail } = require("../config");

/**
 * Inject a GitLab PAT into an HTTPS clone URL so git can authenticate.
 * Transforms: https://gitlab.com/group/project.git
 *         →  https://oauth2:{TOKEN}@gitlab.com/group/project.git
 *
 * Only modifies HTTPS URLs. SSH/git:// URLs are returned unchanged.
 * GitLab accepts `oauth2` as the username with a PAT as the password.
 * Git strips the `userinfo` component when storing the remote URL.
 */
function injectTokenIntoUrl(url, token) {
  if (!url || !token) return url;
  if (!url.startsWith("https://")) return url;
  const u = new URL(url);
  u.username = "oauth2";
  u.password = token;
  return u.toString();
}

async function repoCloneCommand(client, flags, output, context) {
  const startedAt = new Date();
  let finalResult = null;
  let status = "success";
  let errorMessage = null;

  try {
    const resolved = await resolveRepoTarget(client, flags);
    if (resolved.status !== "resolved") {
      finalResult = {
        mode: "success",
        command: "repo clone",
        operationMode: flags["operation-mode"] || "resolve",
        result: resolved,
        metadata: { gitlabBaseUrl: client.baseUrl },
        warnings: ["No clone performed."],
        nextSteps: [resolved.instruction || "Rerun with exact selector."],
      };
      return;
    }

    const repo = resolved.repo;
    const repoPath = repo.path_with_namespace;
    const cloneRoot = path.resolve(flags.dest || resolveCloneRoot(flags, context.invocationCwd));

    // --fresh bypasses ALL existing-clone resolution (index and scan),
    // forcing a new clone to the resolved clone-root.
    const rawExisting = flags.fresh
      ? null
      : resolveExistingRepo({
          invocationCwd: context.invocationCwd,
          cloneRoot,
          runtimeBaseUrl: client.baseUrl,
          repoPath,
        });

    // When the indexed repo was created under a different clone-root,
    // ignore it and force a fresh clone to the requested clone-root.
    // This prevents `repo clone --clone-root /new/path` from silently
    // reusing a clone in ~/Desktop/gitlab-repos/.
    const existing = rawExisting && (rawExisting.repoDir.startsWith(cloneRoot + path.sep) || rawExisting.repoDir === cloneRoot)
      ? rawExisting
      : null;

    if (existing) {
      finalResult = {
        mode: "success",
        command: "repo clone",
        operationMode: null,
        result: {
          reusedExisting: true,
          repoDir: existing.repoDir,
          cloneRoot,
          canonicalRepoKey: existing.canonicalRepoKey,
          detectionSource: existing.detectionSource,
        },
        metadata: {
          gitlabBaseUrl: client.baseUrl,
          repoPath,
        },
        warnings: [],
        nextSteps: [],
      };
      return;
    }

    const targetDir = determineTargetDir(cloneRoot, client.baseUrl, repoPath);
    const cloneUrl = injectTokenIntoUrl(repo.http_url_to_repo, process.env.GITLAB_TOKEN);
    try {
      runGit(["clone", cloneUrl, targetDir], context.invocationCwd, {
        env: Object.assign({}, process.env, context.gitEnv || {}),
      });
    } catch (err) {
      if (err.message.includes("certificate verification failed") || err.message.includes("SSL certificate problem") || err.message.includes("CAfile:")) {
        throw new Error(
          "GitLab TLS Verification Failed.\n" +
          "You MUST provide the GitLab CA Certificate to the CLI to clone this repository securely.\n" +
          "Add GITLAB_CA_BUNDLE to your process environment or .env file.\n" +
          "DO NOT use GIT_SSL_NO_VERIFY=1 or insecure modes."
        );
      }
      if (context.flags && context.flags.debug) {
        throw err;
      }
      throw new Error(
        "Unable to clone repository. " + (err.message || "").substring(0, 100) +
        "... Please check your access or contact support."
      );
    }
    const canonicalRepoKey = rememberRepo({
      invocationCwd: context.invocationCwd,
      runtimeBaseUrl: client.baseUrl,
      repoPath,
      repoDir: targetDir,
    });

    finalResult = {
      mode: "success",
      command: "repo clone",
      operationMode: null,
      result: {
        reusedExisting: false,
        repoDir: targetDir,
        cloneRoot,
        canonicalRepoKey,
        detectionSource: "fresh-clone",
      },
      metadata: {
        gitlabBaseUrl: client.baseUrl,
        repoPath,
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
      command: "repo clone",
      user_email: getUserEmail(),
      status,
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: new Date().getTime() - startedAt.getTime(),
      input_flags: extractInputFlags(flags, "repo clone"),
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
  repoCloneCommand,
};
