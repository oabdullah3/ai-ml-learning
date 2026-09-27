const { CliError } = require("../errors");
const { parseTopLevelPagination, makePaginationMeta } = require("../utils/pagination");
const { createExplain } = require("../utils/explain");
const { saveLog, extractInputFlags } = require("../log");

async function projectSearchCommand(client, args, output) {
  const startedAt = new Date();
  const userEmail = client?.email || "unknown";
  const inputFlags = extractInputFlags(args, "project search");

  let status = "success";
  let result = {};
  let error = null;

  const query = args.query;
  const topLevelPagination = parseTopLevelPagination(args, { defaultMax: 50, defaultStart: 0 });
  const withComponents = Boolean(args["with-components"]);
  const operationMode = String(args["operation-mode"] || "search").toLowerCase();
  const fallbackBehavior = [];
  let fieldsRequested = ["id", "key", "name", "issueTypes"];

  function withExplain(payload, details) {
    const explain = createExplain(args, details);
    if (!explain) {
      return payload;
    }
    return { ...payload, explain };
  }

  try {
    if (!query) {
      throw new CliError("Missing required flag: --query", 3);
    }

    if (!["search"].includes(operationMode)) {
      throw new CliError("Invalid --operation-mode for project search. Allowed: search", 3);
    }

    const data = await client.searchProjects(query, topLevelPagination.startAt, topLevelPagination.maxResults);
    const projects = data.values || [];

    fieldsRequested = [
      "id",
      "key",
      "name",
      "issueTypes",
      ...(withComponents ? ["components"] : []),
    ];

    for (const project of projects) {
      if (!project?.id) {
        continue;
      }

      try {
        const typesPayload = await client.getIssueTypesForProject(project.id);
        const issueTypes = Array.isArray(typesPayload)
          ? typesPayload
          : Array.isArray(typesPayload?.issueTypes)
            ? typesPayload.issueTypes
            : [];
        project.issueTypes = issueTypes;
      } catch (err) {
        project.issueTypes = [];
        project.issueTypesError = err.message;
        fallbackBehavior.push(`Issue types fetch failed for project ${project.key || project.id}; returned empty issueTypes.`);
      }

      if (withComponents) {
        try {
          const compsPayload = await client.getProjectComponents(project.id);
          project.components = Array.isArray(compsPayload)
            ? compsPayload
            : Array.isArray(compsPayload?.values)
              ? compsPayload.values
              : [];
        } catch (err) {
          project.components = [];
          project.componentsError = err.message;
          fallbackBehavior.push(`Components fetch failed for project ${project.key || project.id}; returned empty components.`);
        }
      }
    }

    result = {
      mode: "project-search",
      query,
      total: data.total,
      startAt: data.startAt,
      maxResults: data.maxResults,
      pagination: makePaginationMeta({
        total: Number.isInteger(data.total) ? data.total : projects.length,
        startAt: Number.isInteger(data.startAt) ? data.startAt : topLevelPagination.startAt,
        maxResults: Number.isInteger(data.maxResults) ? data.maxResults : topLevelPagination.maxResults,
        returned: projects.length,
        strategy: "server",
      }),
      projects,
    };
  } catch (err) {
    status = "failure";
    error = err.message;
    result = {};
    throw err;
  } finally {
    const finishedAt = new Date();
    const logPayload = {
      tool_name: "agent-jira-cli",
      command: "project search",
      user_email: userEmail,
      status,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: Math.abs(finishedAt.getTime() - startedAt.getTime()),
      input_flags: inputFlags,
      result,
      metadata: {},
      error,
    };
    const logErrors = await saveLog(logPayload, { envDir: args["env-dir"] });

    if (status === "success") {
      if (logErrors) {
        result.logErrors = logErrors;
      }
      output(withExplain(result, {
        selectors: { query, "operation-mode": operationMode },
        queryPlan: { route: "project-search", action: "searchProjects" },
        fieldsRequested,
        enrichmentPlan: { withComponents },
        paginationPlan: { topLevel: topLevelPagination },
        fallbackBehavior,
      }));
    }
  }
}

module.exports = {
  projectSearchCommand,
};