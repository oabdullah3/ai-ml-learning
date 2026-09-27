
const API_URL = "https://telemetry.example.invalid/api/v1/logs";
const fs = require("fs");
const path = require("path");
const os = require("os");
// Module-level envDir for TELEMETRY_API_KEY resolution
let _envDir = null;

function setEnvDir(envDir) {
  _envDir = envDir;
}
function readDotEnvFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    return {}; // Return empty object if .env file not found
  }

  const result = {};
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const exportStripped = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const idx = exportStripped.indexOf("=");
    if (idx < 1) continue;

    const key = exportStripped.slice(0, idx).trim();
    const valueRaw = exportStripped.slice(idx + 1).trim();
    result[key] = stripWrappingQuotes(valueRaw);
  }

  return result;
}

function stripWrappingQuotes(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function getLogPayloadsDir() {
  const candidates = [
    path.join(process.cwd(), "log_payloads"),
    path.join(os.homedir(), "log_payloads"),
  ];

  for (const logsDir of candidates) {
    try {
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
      if (fs.existsSync(logsDir)) {
        return logsDir;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function formatDateForFilename(date) {
  return date.toISOString().split("T")[0];
}

function formatDateTimeForFilename(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function getTelemetryApiKey() {
  // First check process.env
  if (process.env.TELEMETRY_API_KEY) {
    return process.env.TELEMETRY_API_KEY;
  }

  // Then try env-dir .env file (from --env-dir flag or CONFLUENCE_ENV_DIR)
  if (_envDir) {
    const envDirEnvPath = path.resolve(_envDir, ".env");
    const envDirEnv = readDotEnvFile(envDirEnvPath);
    if (envDirEnv.TELEMETRY_API_KEY) {
      return envDirEnv.TELEMETRY_API_KEY;
    }
  }

  // Then try local .env file
  const localEnvPath = path.join(process.cwd(), ".env");
  const localEnv = readDotEnvFile(localEnvPath);
  if (localEnv.TELEMETRY_API_KEY) {
    return localEnv.TELEMETRY_API_KEY;
  }

  // Then try .env in user's home .openclaw dir
  const homeOpenClawEnvPath = path.join(require("os").homedir(), ".env");
  const homeOpenClawEnv = readDotEnvFile(homeOpenClawEnvPath);
  if (homeOpenClawEnv.TELEMETRY_API_KEY) {
    return homeOpenClawEnv.TELEMETRY_API_KEY;
  }

  return null;
}

function simplifyArrayWithTitlePreview(arr) {
  if (!Array.isArray(arr)) return { totalCount: 0, previewTitles: [] };
  return {
    totalCount: arr.length,
    previewTitles: arr.slice(0, 3).map(item => item.title || "").filter(Boolean)
  };
}

function simplifyResultForLog(command, result) {
  if (!result) return {};
  let simplified;
  try {
    simplified = JSON.parse(JSON.stringify(result));
  } catch (_err) {
    simplified = { ...result };
  }

  // Command-specific simplification
  switch (command) {
    case "me":
      if (simplified.recentEdits) {
        simplified.retrievedRecentEdits = simplified.recentEdits.length;
        delete simplified.recentEdits;
      }
      if (simplified.drafts) {
        simplified.retrievedDrafts = simplified.drafts.length;
        delete simplified.drafts;
      }
      if (simplified.savedPages) {
        simplified.retrievedSavedPages = simplified.savedPages.length;
        delete simplified.savedPages;
      }
      break;
    case "page create":
      if (typeof simplified.instruction !== "undefined") {
        delete simplified.instruction;
      }
      if (simplified.mode === "page-create-preview-ready" && simplified.preview) {
        if (typeof simplified.preview.contentPreview !== "undefined") {
          delete simplified.preview.contentPreview;
        }
        if (typeof simplified.preview.fullContent !== "undefined") {
          delete simplified.preview.fullContent;
        }
      }
      if (simplified.mode === "page-create" && typeof simplified.auditComment !== "undefined") {
        delete simplified.auditComment;
      }
      break;
    case "page edit content":
      if (simplified.mode === "page-edit-content-ready") {
        if (typeof simplified.instruction !== "undefined") {
          delete simplified.instruction;
        }
        if (typeof simplified.pipeLocation !== "undefined") {
          delete simplified.pipeLocation;
        }
        if (typeof simplified.inlineAttachmentInsertions !== "undefined") {
          simplified.inlineAttachmentCounts = Array.isArray(simplified.inlineAttachmentInsertions)
            ? simplified.inlineAttachmentInsertions.length
            : 0;
          delete simplified.inlineAttachmentInsertions;
        }
      }

      if (simplified.mode === "page-edit-content-changes-ready") {
        if (typeof simplified.instruction !== "undefined") {
          delete simplified.instruction;
        }
        if (typeof simplified.diffPreview !== "undefined") {
          delete simplified.diffPreview;
        }
        if (typeof simplified.diffFull !== "undefined") {
          delete simplified.diffFull;
        }
        if (typeof simplified.diffHunks !== "undefined") {
          delete simplified.diffHunks;
        }
      }

      if (simplified.mode === "page-edit-content") {
        if (typeof simplified.auditComment !== "undefined") {
          delete simplified.auditComment;
        }
        if (typeof simplified.inlineComments !== "undefined") {
          simplified.inlineCommentsCount = Array.isArray(simplified.inlineComments)
            ? simplified.inlineComments.length
            : simplified.inlineComments
              ? 1
              : 0;
          delete simplified.inlineComments;
        }
      }
      break;
    case "page edit details":
      if (simplified.mode === "page-edit-details-awaiting-approval") {
        if (typeof simplified.instruction !== "undefined") {
          delete simplified.instruction;
        }
      }
      if (simplified.mode === "page-edit-details") {
        if (typeof simplified.auditComment !== "undefined") {
          delete simplified.auditComment;
        }
      }
      break;
    case "space search":
      if (Array.isArray(simplified.spaces)) {
        simplified.retrievedSpaces = simplified.spaces.length;
        delete simplified.spaces;
      }
      if (Array.isArray(simplified.labels)) {
        simplified.retrievedLabels = simplified.labels.length;
        delete simplified.labels;
      }
      if (Array.isArray(simplified.permissions)) {
        simplified.retrievedPermissions = simplified.permissions.length;
        delete simplified.permissions;
      }
      break;
    case "page search":
      if (typeof simplified.content !== "undefined") {
        const contentLength =
          typeof simplified.content === "string"
            ? simplified.content.length
            : JSON.stringify(simplified.content).length;
        simplified.contentLength = contentLength;
        delete simplified.content;
      }
      if (simplified.restrictions) {
        const readUserCount = simplified.restrictions?.read?.restrictions?.user?.size;
        const updateUserCount = simplified.restrictions?.update?.restrictions?.user?.size;
        simplified.restrictionsSummary = {
          readUserCount: Number.isFinite(readUserCount) ? readUserCount : null,
          updateUserCount: Number.isFinite(updateUserCount) ? updateUserCount : null,
        };
        delete simplified.restrictions;
      }
      if (Array.isArray(simplified.pages)) {
        simplified.retrievedPages = simplified.pages.length;
        delete simplified.pages;
      }
      if (Array.isArray(simplified.labels)) {
        simplified.retrievedLabels = simplified.labels.length;
        delete simplified.labels;
      }
      if (Array.isArray(simplified.comments)) {
        simplified.retrievedComments = simplified.comments.length;
        delete simplified.comments;
      }
      if (Array.isArray(simplified.ancestors)) {
        simplified.retrievedAncestors = simplified.ancestors.length;
        delete simplified.ancestors;
      }
      if (Array.isArray(simplified.children)) {
        simplified.retrievedChildren = simplified.children.length;
        delete simplified.children;
      }
      if (Array.isArray(simplified.attachments)) {
        simplified.retrievedAttachments = simplified.attachments.length;
        delete simplified.attachments;
      }
      break;
    // Other commands will be added here later
  }

  return simplified;
}

async function saveLog(logPayload) {
  const errors = {};

  const apiLogPayload = {
    ...logPayload,
    result: simplifyResultForLog(logPayload.command, logPayload.result)
  };

  const logsDir = getLogPayloadsDir();
  if (logsDir) {
    const todayDate = formatDateForFilename(new Date());
    const dateDir = path.join(logsDir, todayDate);

    try {
      if (!fs.existsSync(dateDir)) {
        fs.mkdirSync(dateDir, { recursive: true });
      }

      const timestamp = formatDateTimeForFilename(new Date());
      const filename = `${timestamp}-${logPayload.command.replace(/ /g, "-")}.json`;
      const filepath = path.join(dateDir, filename);

      fs.writeFileSync(filepath, JSON.stringify(logPayload, null, 2));
    } catch (err) {
      errors.localSave = err.message;
    }
  } else {
    errors.localSave = "Unable to create log_payloads directory in CWD or home directory";
  }

  try {
    const apiKey = getTelemetryApiKey();
    if (apiKey) {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify(apiLogPayload)
      });

      if (!response.ok) {
        errors.api = `${response.status} ${response.statusText}`;
      }
    }
  } catch (err) {
    errors.api = err.message;
  }

  return Object.keys(errors).length > 0 ? errors : null;
}

module.exports = { saveLog, setEnvDir };
