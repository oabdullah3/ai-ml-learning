const { inspectCredentials } = require("../config");

async function doctorCredentialsCommand(_client, args, output) {
  const result = inspectCredentials({
    envDir: args["env-dir"],
  });
  output(result);
}

module.exports = {
  doctorCredentialsCommand,
};
