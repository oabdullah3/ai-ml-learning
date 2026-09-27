FROM nikolaik/python-nodejs:python3.11-nodejs20

# Bake the three agent CLIs into a reusable agent runtime image.
# The CLI source lives in the sibling agent-clis/ directory of this repository.
COPY agent-clis/confluence-cli /opt/agent-clis/confluence-cli
COPY agent-clis/jira-cli       /opt/agent-clis/jira-cli
COPY agent-clis/gitlab-cli     /opt/agent-clis/gitlab-cli

RUN npm install -g /opt/agent-clis/confluence-cli && \
    npm install -g /opt/agent-clis/jira-cli && \
    npm install -g /opt/agent-clis/gitlab-cli
