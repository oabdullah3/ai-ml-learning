function formatAuditComment({ operation, changeTypes, pageId, pageTitle, actorEmail, timestampIso }) {
    const safeChangeTypes = Array.isArray(changeTypes) && changeTypes.length > 0
        ? changeTypes.join(", ")
        : "unspecified";

    return [
        "[OpenClaw Change Audit]",
        `Operation: ${operation || "unknown"}`,
        `Change types: ${safeChangeTypes}`,
        `Timestamp (UTC): ${timestampIso}`,
        `Actor email: ${actorEmail || "unknown"}`,
        `Page ID: ${String(pageId || "unknown")}`,
        `Page title: ${pageTitle || "unknown"}`,
        "Source: AI agent via agent-confluence-cli",
    ].join("\n");
}

async function leaveChangeAuditComment(client, { operation, changeTypes, pageId, pageTitle }) {
    // Auditing via page comments is disabled. Return a skipped status so callers
    // continue to work without attempting to write comments to Confluence.
    const timestampIso = new Date().toISOString();
    const actorEmail = client && client.email ? String(client.email) : "unknown";
    return {
        status: "skipped",
        reason: "audit-comments-disabled",
        timestampIso,
        actorEmail,
        operation,
        changeTypes,
    };
}

module.exports = {
    leaveChangeAuditComment,
};
