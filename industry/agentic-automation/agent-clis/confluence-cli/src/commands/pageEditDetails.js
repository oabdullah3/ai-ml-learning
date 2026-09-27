const { CliError } = require("../errors");
const { rejectUnknownFlags } = require("../utils");
const { leaveChangeAuditComment } = require("../utils/changeAuditComment");
const { loadMetadata, storeMetadata, clearBoth } = require("../utils/pipeMetadata");
const { saveLog } = require("../log");
const fs = require("fs");
const crypto = require("crypto");

function generateWorkflowId() {
    return crypto.randomUUID();
}

function buildWorkflowContext({ pageId, comment, labels, attachmentPaths, newTitle, userEmail }) {
    return {
        command: "page edit details",
        pageId: String(pageId),
        comment: comment || null,
        labels: [...labels].sort(),
        attachmentPaths: [...attachmentPaths].sort(),
        newTitle: newTitle || null,
        userEmail: userEmail || null,
    };
}

function contextsMatch(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function parseLabels(rawLabelValue) {
    if (!rawLabelValue) {
        return [];
    }

    return String(rawLabelValue)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

function parseAttachmentPaths(rawAttachmentValue) {
    if (!rawAttachmentValue) {
        return [];
    }

    return String(rawAttachmentValue)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

function validateAttachmentPaths(paths) {
    for (const filePath of paths) {
        if (!fs.existsSync(filePath)) {
            throw new CliError(`Attachment file does not exist: ${filePath}`, 3);
        }
        if (!fs.statSync(filePath).isFile()) {
            throw new CliError(`Attachment path is not a file: ${filePath}`, 3);
        }
    }
}

async function pageEditDetailsCommand(client, args, output) {
    rejectUnknownFlags(
        args,
        ["page-id", "comment", "label", "attachment-path", "new-title", "operation-mode", "human-approval-obtained", "pipe-dir"],
        "page edit details"
    );

    const startedAt = new Date();
    const userEmail = client.email;
    const inputFlags = {};
    if (args["page-id"]) inputFlags["page-id"] = args["page-id"];
    if (args.comment) inputFlags.comment = args.comment;
    if (args.label) inputFlags.label = args.label;
    if (args["attachment-path"]) inputFlags["attachment-path"] = args["attachment-path"];
    if (args["new-title"]) inputFlags["new-title"] = args["new-title"];
    if (args["operation-mode"]) inputFlags["operation-mode"] = args["operation-mode"];
    if (args["human-approval-obtained"]) inputFlags["human-approval-obtained"] = true;


    const pageId = args["page-id"];
    const pipeDir = args["pipe-dir"];
    const operationMode = args["operation-mode"] || "prepare";
    const approvalObtained = Boolean(args["human-approval-obtained"]);
    const comment = args.comment ? String(args.comment).trim() : "";
    const labels = parseLabels(args.label);
    const attachmentPaths = parseAttachmentPaths(args["attachment-path"]);
    const newTitle = args["new-title"] ? String(args["new-title"]).trim() : "";

    if (!pageId) {
        throw new CliError("Missing required: --page-id", 3);
    }

    if (!comment && labels.length === 0 && attachmentPaths.length === 0 && !newTitle) {
        throw new CliError("Provide at least one details flag: --comment, --label, --attachment-path, or --new-title", 3);
    }

    validateAttachmentPaths(attachmentPaths);

    let currentTitle = null;
    if (newTitle) {
        let pageData;
        try {
            pageData = await client.getPage(pageId, "title");
        } catch (err) {
            throw new CliError(`Failed to load page title for rename: ${err.message}`, err.exitCode || 10);
        }

        currentTitle = String(pageData?.title || "").trim();
        if (!currentTitle) {
            throw new CliError("Unable to resolve current page title for rename", 10);
        }

        if (currentTitle === newTitle) {
            throw new CliError("--new-title matches the existing page title", 3);
        }
    }

    let status = "success";
    let result = {};
    let error = null;
    let workflowId = null;
    const stage = operationMode;
    const workflowContext = buildWorkflowContext({
        pageId,
        comment,
        labels,
        attachmentPaths,
        newTitle,
        userEmail,
    });

    try {
        if (operationMode === "prepare") {
            // Prepare: always generate new workflowId
            workflowId = generateWorkflowId();
            try {
                const existingMetadata = loadMetadata(pipeDir) || {};
                existingMetadata.workflowId = workflowId;
                existingMetadata.workflowCommand = "page edit details";
                existingMetadata.workflowContext = workflowContext;
                existingMetadata.workflowPreparedAt = new Date().toISOString();
                storeMetadata(existingMetadata, pipeDir);
            } catch {
                // Ignore metadata errors (e.g., read-only file system)
            }

            result = {
                mode: "page-edit-details-awaiting-approval",
                message: "Details update prepared. Review planned operations.",
                pageId: String(pageId),
                plannedOperations: {
                    renameTitle: newTitle ? { from: currentTitle, to: newTitle } : null,
                    addComment: comment || null,
                    addLabels: labels,
                    addAttachments: attachmentPaths,
                },
                instruction:
                    "If approved, rerun with --operation-mode finalize --human-approval-obtained and the same detail flags.",
            };
            //output(result);
            return result;
        }

        if (operationMode !== "finalize") {
            throw new CliError("Unknown operation-mode. Use 'prepare' or 'finalize'.", 3);
        }

        if (!approvalObtained) {
            throw new CliError("Missing flag: --human-approval-obtained. Explicit approval required.", 3);
        }

        // Finalize must reuse and validate the prepare-time workflow state.
        let existingMetadata;
        try {
            existingMetadata = loadMetadata(pipeDir);
        } catch (err) {
            throw new CliError(`Failed to load workflow state. Run prepare again. ${err.message}`, 10);
        }

        if (!existingMetadata) {
            throw new CliError("Workflow state not found. Run prepare again before finalize.", 3);
        }

        if (!existingMetadata.workflowId) {
            throw new CliError("Workflow state is incomplete. Run prepare again before finalize.", 3);
        }

        if (existingMetadata.workflowCommand !== "page edit details") {
            throw new CliError("Workflow state belongs to a different command. Run prepare again before finalize.", 3);
        }

        if (!existingMetadata.workflowContext) {
            throw new CliError("Workflow context is missing. Run prepare again before finalize.", 3);
        }

        if (!contextsMatch(existingMetadata.workflowContext, workflowContext)) {
            throw new CliError(
                "Workflow state does not match the current detail flags. Run prepare again with the exact intended flags before finalize.",
                3
            );
        }
        workflowId = existingMetadata.workflowId;

        const finalizeResult = {
            pageId: String(pageId),
        };

        if (newTitle) {
            let updatedPage;
            try {
                updatedPage = await client.updatePageTitle(pageId, newTitle);
            } catch (err) {
                throw new CliError(`Title rename failed: ${err.message}`, err.exitCode || 10);
            }

            finalizeResult.title = {
                oldTitle: currentTitle,
                newTitle: updatedPage?.title || newTitle,
            };
        }

        if (comment) {
            let createdComment;
            try {
                createdComment = await client.addPageComment(pageId, comment);
            } catch (err) {
                throw new CliError(`Comment update failed: ${err.message}`, err.exitCode || 10);
            }

            finalizeResult.comment = {
                commentId: createdComment.id,
                url: createdComment._links?.webui || createdComment._links?.self,
            };
        }

        if (labels.length > 0) {
            try {
                await client.addPageLabels(pageId, labels);
            } catch (err) {
                throw new CliError(`Label update failed: ${err.message}`, err.exitCode || 10);
            }
            finalizeResult.labels = labels;
        }

        if (attachmentPaths.length > 0) {
            const uploaded = [];
            for (const filePath of attachmentPaths) {
                try {
                    const uploadResult = await client.addPageAttachment(pageId, filePath, "Uploaded via confluence-cli page edit details");
                    const first = uploadResult?.results?.[0] || uploadResult;
                    uploaded.push({
                        id: first?.id || null,
                        title: first?.title || first?.name || filePath,
                        sourcePath: filePath,
                    });
                } catch (err) {
                    throw new CliError(`Attachment upload failed for '${filePath}': ${err.message}`, err.exitCode || 10);
                }
            }
            finalizeResult.attachments = uploaded;
        }

        const changeTypes = [];
        if (newTitle) changeTypes.push("title:rename");
        if (comment) changeTypes.push("comment:add");
        if (labels.length > 0) changeTypes.push("label:update");
        if (attachmentPaths.length > 0) changeTypes.push("attachment:add");

        const auditComment = await leaveChangeAuditComment(client, {
            operation: "page edit details",
            changeTypes,
            pageId: String(pageId),
            pageTitle: finalizeResult?.title?.newTitle || currentTitle || "Unknown",
        });

        result = {
            mode: "page-edit-details",
            message: "Page details updated successfully.",
            updated: finalizeResult,
            auditComment,
        };
        //output(result);
        try {
            clearBoth(pipeDir, pipeDir);
        } catch {
            // Ignore metadata clear errors
        }
        return result;
    } catch (err) {
        status = "failure";
        error = err.message;
        result = {};
        if (!workflowId && operationMode === "prepare") {
            workflowId = generateWorkflowId();
        }
        throw err;
    } finally {
        const finishedAt = new Date();
        const durationMs = Math.abs(finishedAt.getTime() - startedAt.getTime());
        const logPayload = {
            tool_name: "agent-confluence-cli",
            command: "page edit details",
            user_email: userEmail,
            status,
            started_at: startedAt.toISOString(),
            finished_at: finishedAt.toISOString(),
            duration_ms: durationMs,
            input_flags: inputFlags,
            result,
            metadata: {
                stage,
                "workflow-id": workflowId
            },
            error
        };
        const logErrors = await saveLog(logPayload);

        if (status === "success") {
            if (logErrors) {
                result.logErrors = logErrors;
            }
            output(result);
        }
    }
}

module.exports = { pageEditDetailsCommand };
