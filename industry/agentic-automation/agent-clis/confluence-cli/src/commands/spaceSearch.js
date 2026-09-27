const { CliError } = require("../errors");
const { rejectUnknownFlags, toInt, parseDetailFlag } = require("../utils");
const { saveLog } = require("../log");

async function spaceSearchCommand(client, args, output) {
  rejectUnknownFlags(args, [
    "space-key", "query", "limit", "start",
    "with-description", "with-homepage", "with-labels", "with-permissions"
  ], "space search");

  const startedAt = new Date();
  const userEmail = client.email;

  const inputFlags = {};
  if (args["space-key"]) inputFlags["space-key"] = args["space-key"];
  if (args.query) inputFlags.query = args.query;
  if (args["with-description"]) inputFlags["with-description"] = true;
  if (args["with-homepage"]) inputFlags["with-homepage"] = true;
  if (args["with-permissions"]) inputFlags["with-permissions"] = args["with-permissions"];
  if (args["with-labels"]) inputFlags["with-labels"] = args["with-labels"];
  if (args.limit) inputFlags.limit = args.limit;
  if (args.start) inputFlags.start = args.start;

  let status = "success";
  let result = {};
  let error = null;

  try {
    const spaceKey = args["space-key"];
    const query = args.query;
    const limit = toInt(args.limit, 10);
    const start = toInt(args.start, 0);

    const withDescription = Boolean(args["with-description"]);
    const withHomepage = Boolean(args["with-homepage"]);

    const labelsConf = parseDetailFlag(args["with-labels"]);
    const permConf = parseDetailFlag(args["with-permissions"]);

    async function augmentSingleSpace(targetSpaceKey, baseOutput) {
      const expansions = [];
      if (withDescription) expansions.push("description.plain");
      if (withHomepage) expansions.push("homepage");

      if (labelsConf.requested) expansions.push("metadata.labels");
      if (permConf.requested) expansions.push("permissions");

      const expandStr = expansions.join(",");
      const spaceData = await client.getSpace(targetSpaceKey, expandStr);

      if (!spaceData || !spaceData.key) {
          throw new CliError(`Space not found for key: ${targetSpaceKey}`, 404);
      }

      baseOutput.spaceData = {
        id: spaceData.id,
        key: spaceData.key,
        name: spaceData.name,
        type: spaceData.type,
      };

      if (withDescription) baseOutput.description = spaceData.description?.plain?.value || "No description";
      if (withHomepage) baseOutput.homepage = spaceData.homepage ? { id: spaceData.homepage.id, title: spaceData.homepage.title } : null;

      if (labelsConf.requested) {
        const allLabels = spaceData.metadata?.labels?.results || [];
        baseOutput.labels = allLabels.slice(labelsConf.start, labelsConf.start + labelsConf.limit);
      }
      if (permConf.requested) {
        const allPermissions = spaceData.permissions || [];
        baseOutput.permissions = allPermissions.slice(permConf.start, permConf.start + permConf.limit);
      }

      return baseOutput;
    }

    if (spaceKey) {
      result = await augmentSingleSpace(spaceKey, {
        mode: "space-search",
        message: `Space details returned for exact key ${spaceKey}`,
      });
      //output(result);
    } else if (!query) {
      throw new CliError("Missing search criteria: provide --space-key or --query", 3);
    } else {
      const data = await client.searchSpaces(query, limit, start);
      const spaces = data.results || [];

      const formattedSpaces = spaces.map((s) => ({
        id: s.id,
        key: s.key,
        name: s.name,
      }));

      if (formattedSpaces.length === 1 && formattedSpaces[0]?.key) {
        const matchedKey = formattedSpaces[0].key;
        result = await augmentSingleSpace(matchedKey, {
          mode: "space-search",
          query,
          total: 1,
          start,
          limit,
          message: `Single exact space match found (${matchedKey}). Returning requested details.`,
        });
        //output(result);
      } else if (formattedSpaces.length > 0 || start > 0) {
        result = {
          mode: "space-search",
          query,
          total: data.totalSize || formattedSpaces.length,
          start,
          limit,
          spaces: formattedSpaces,
          message: formattedSpaces.length > 1 
            ? "MULTIPLE spaces found. Detail flags ignored. Please use --space-key to narrow down."
            : formattedSpaces.length === 1
              ? "Single space found. Use --space-key for full details."
              : "No spaces found at this pagination offset.",
        };
        //output(result);
      } else {
        result = { mode: "space-search", query, total: 0, start, limit, spaces: [], message: "No spaces found." };
        //output(result);
      }
    }
  } catch (err) {
    status = "failure";
    error = err.message;
    result = {};
    throw err;
  } finally {
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();

    const logPayload = {
      tool_name: "agent-confluence-cli",
      command: "space search",
      user_email: userEmail,
      status,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: durationMs,
      input_flags: inputFlags,
      result,
      metadata: {},
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

module.exports = { spaceSearchCommand };