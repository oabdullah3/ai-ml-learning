const path = require("path");

function resolveStateDir(invocationCwd = process.cwd()) {
  const configured = process.env.GITLAB_STATE_DIR;
  return path.resolve(configured || path.join(invocationCwd, ".gitlab-cli"));
}

function resolveEnvFilePath(flags = {}) {
  const explicitDir = flags["env-dir"];
  if (explicitDir) {
    return path.resolve(explicitDir, ".env");
  }

  const explicitPath = process.env.GITLAB_ENV_PATH;
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  const legacyEnvPath = process.env.GITLAB_ENV_DIR;
  if (legacyEnvPath) {
    return path.resolve(legacyEnvPath, ".env");
  }

  return null;
}

module.exports = {
  resolveStateDir,
  resolveEnvFilePath,
};
