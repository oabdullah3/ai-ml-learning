const {
  parseTopLevelPagination,
  parseTupleFlag,
  paginateArray,
  makePaginationMeta,
} = require("../utils/pagination");
const { createExplain } = require("../utils/explain");
const { saveLog, extractInputFlags } = require("../log");

async function meCommand(client, args, output) {
  const startedAt = new Date();
  const userEmail = client?.email || "unknown";
  const inputFlags = extractInputFlags(args, "me");

  let status = "success";
  let result = {};
  let error = null;

  const topLevelPagination = parseTopLevelPagination(args, { defaultMax: 20, defaultStart: 0 });
  const withComments = parseTupleFlag(args, "with-comments", { defaultMax: 20, defaultStart: 0 });
  const withTransitions = parseTupleFlag(args, "with-transitions", { defaultMax: 20, defaultStart: 0 });
  const withAssignable = parseTupleFlag(args, "with-assignable", { defaultMax: 20, defaultStart: 0 });
  const withWorklogs = parseTupleFlag(args, "with-worklogs", { defaultMax: 20, defaultStart: 0 });
  const withAttachments = parseTupleFlag(args, "with-attachments", { defaultMax: 20, defaultStart: 0 });
  const fields = "summary,status,assignee,issuetype,priority,updated";
  const fallbackBehavior = [];
  const selectedCategories = ["assigned", "reported", "watched", "recent"].filter((key) => Boolean(args[key]));

  function withExplain(payload, details) {
    const explain = createExplain(args, details);
    if (!explain) {
      return payload;
    }
    return { ...payload, explain };
  }

  try {
    const profile = await client.getMyself();

    result = {
      mode: "me",
      profile: {
        accountId: profile.accountId,
        displayName: profile.displayName,
        emailAddress: profile.emailAddress,
        timeZone: profile.timeZone,
      },
      pagination: {
        categories: {
          startAt: topLevelPagination.startAt,
          maxResults: topLevelPagination.maxResults,
          strategy: "server",
        },
      },
    };

    const enrichmentFlagsEnabled =
      withComments.enabled ||
      withTransitions.enabled ||
      withAssignable.enabled ||
      withWorklogs.enabled ||
      withAttachments.enabled;

    async function enrichIssue(issue) {
      const enriched = { ...issue };
      const issueKey = issue?.key;
      if (!issueKey) {
        return enriched;
      }

      const enrichmentPagination = {};

      if (withComments.enabled) {
        const commentsData = await client.getIssueComments(issueKey, withComments.startAt, withComments.maxResults);
        enriched.comments = commentsData.comments || [];
        enrichmentPagination.comments = makePaginationMeta({
          total: Number.isInteger(commentsData.total) ? commentsData.total : enriched.comments.length,
          startAt: Number.isInteger(commentsData.startAt) ? commentsData.startAt : withComments.startAt,
          maxResults: Number.isInteger(commentsData.maxResults) ? commentsData.maxResults : withComments.maxResults,
          returned: enriched.comments.length,
          strategy: "server",
        });
      }

      if (withTransitions.enabled) {
        const transitionsData = await client.getIssueTransitions(issueKey);
        const transitionSlice = paginateArray(transitionsData.transitions || [], withTransitions.startAt, withTransitions.maxResults);
        enriched.transitions = transitionSlice.values;
        enrichmentPagination.transitions = makePaginationMeta({
          total: transitionSlice.total,
          startAt: transitionSlice.startAt,
          maxResults: transitionSlice.maxResults,
          returned: transitionSlice.values.length,
          strategy: "client",
        });
      }

      if (withAssignable.enabled) {
        try {
          const assignableData = await client.getAssignableUsers(issueKey, withAssignable.startAt, withAssignable.maxResults);
          const normalized = Array.isArray(assignableData)
            ? assignableData
            : Array.isArray(assignableData?.values)
              ? assignableData.values
              : [];
          enriched.assignableUsers = normalized.map((u) => ({
            accountId: u.accountId,
            displayName: u.displayName,
            emailAddress: u.emailAddress,
          }));
          const assignableTotal = Number.isInteger(assignableData?.total)
            ? assignableData.total
            : withAssignable.startAt + enriched.assignableUsers.length;
          enrichmentPagination.assignableUsers = makePaginationMeta({
            total: assignableTotal,
            startAt: withAssignable.startAt,
            maxResults: withAssignable.maxResults,
            returned: enriched.assignableUsers.length,
            strategy: "server",
          });
        } catch (err) {
          enriched.assignableUsers = [];
          enriched.assignableUsersError = err.message;
          fallbackBehavior.push(`Assignable users enrichment failed for issue ${issueKey}; returned empty assignableUsers.`);
        }
      }

      if (withWorklogs.enabled) {
        const worklogData = await client.getIssueWorklogs(issueKey, withWorklogs.startAt, withWorklogs.maxResults);
        enriched.worklogs = worklogData.worklogs || [];
        enrichmentPagination.worklogs = makePaginationMeta({
          total: Number.isInteger(worklogData.total) ? worklogData.total : enriched.worklogs.length,
          startAt: Number.isInteger(worklogData.startAt) ? worklogData.startAt : withWorklogs.startAt,
          maxResults: Number.isInteger(worklogData.maxResults) ? worklogData.maxResults : withWorklogs.maxResults,
          returned: enriched.worklogs.length,
          strategy: "server",
        });
      }

      if (withAttachments.enabled) {
        const attachmentData = await client.getIssueAttachments(issueKey);
        const attachmentSlice = paginateArray(attachmentData, withAttachments.startAt, withAttachments.maxResults);
        enriched.attachments = attachmentSlice.values;
        enrichmentPagination.attachments = makePaginationMeta({
          total: attachmentSlice.total,
          startAt: attachmentSlice.startAt,
          maxResults: attachmentSlice.maxResults,
          returned: attachmentSlice.values.length,
          strategy: "client",
        });
      }

      if (Object.keys(enrichmentPagination).length > 0) {
        enriched.enrichmentPagination = enrichmentPagination;
      }

      return enriched;
    }

    async function queryCategory(jql) {
      const data = await client.searchIssuesJql(
        jql,
        topLevelPagination.maxResults,
        fields,
        topLevelPagination.startAt
      );
      const issues = data.issues || [];
      const values = enrichmentFlagsEnabled
        ? await Promise.all(issues.map((issue) => enrichIssue(issue)))
        : issues;

      return {
        values,
        pagination: makePaginationMeta({
          total: Number.isInteger(data.total) ? data.total : values.length,
          startAt: Number.isInteger(data.startAt) ? data.startAt : topLevelPagination.startAt,
          maxResults: Number.isInteger(data.maxResults) ? data.maxResults : topLevelPagination.maxResults,
          returned: values.length,
          strategy: "server",
        }),
      };
    }

    if (args.assigned) {
      const jql = "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC";
      const data = await queryCategory(jql);
      result.assigned = data.values;
      result.pagination.assigned = data.pagination;
    }

    if (args.reported) {
      const jql = "reporter = currentUser() AND statusCategory != Done ORDER BY updated DESC";
      const data = await queryCategory(jql);
      result.reported = data.values;
      result.pagination.reported = data.pagination;
    }

    if (args.watched) {
      const jql = "watcher = currentUser() AND statusCategory != Done ORDER BY updated DESC";
      const data = await queryCategory(jql);
      result.watched = data.values;
      result.pagination.watched = data.pagination;
    }

    if (args.recent) {
      const jql = "issuekey in issueHistory() ORDER BY lastViewed DESC";
      const data = await queryCategory(jql);
      result.recent = data.values;
      result.pagination.recent = data.pagination;
    }
  } catch (err) {
    status = "failure";
    error = err.message;
    result = {};
    throw err;
  } finally {
    const finishedAt = new Date();
    const logPayload = {
      tool_name: "agent-jira-cli",
      command: "me",
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
        selectors: {
          categories: selectedCategories,
        },
        queryPlan: {
          route: "me",
          profileLookup: "getMyself",
          categoryQueries: selectedCategories.reduce((acc, key) => {
            acc[key] = categoryQueries[key];
            return acc;
          }, {}),
        },
        fieldsRequested: fields.split(","),
        enrichmentPlan: {
          comments: withComments,
          transitions: withTransitions,
          assignableUsers: withAssignable,
          worklogs: withWorklogs,
          attachments: withAttachments,
        },
        paginationPlan: {
          topLevel: topLevelPagination,
          categories: result.pagination,
        },
        fallbackBehavior,
      }));
    }
  }
}

module.exports = {
  meCommand,
};