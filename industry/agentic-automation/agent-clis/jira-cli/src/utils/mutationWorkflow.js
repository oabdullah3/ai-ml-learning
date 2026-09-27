const crypto = require("crypto");
const { CliError } = require("../errors");

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function sha256(text) {
  return crypto.createHash("sha256").update(String(text)).digest("hex");
}

function buildPlanHash(payload) {
  return sha256(stableStringify(payload));
}

function buildPlanId(commandName, targetKey, planHash) {
  return sha256(`${commandName}:${targetKey}:${planHash}`).slice(0, 20);
}

function buildDiffSummary({ before, plannedOperations, afterIntent, warnings, destructiveMarkers }) {
  return {
    before,
    plannedOperations,
    afterIntent,
    warnings: warnings || [],
    destructiveMarkers: destructiveMarkers || [],
  };
}

function requireNoDryRun(args, commandName) {
  if (args["dry-run"] !== undefined) {
    throw new CliError(
      `Flag --dry-run is no longer supported for ${commandName}. Use --operation-mode prepare or --operation-mode show-changes instead.`,
      3
    );
  }
}

module.exports = {
  buildPlanHash,
  buildPlanId,
  buildDiffSummary,
  requireNoDryRun,
};
