# AI & Machine Learning Portfolio

A curated collection of coursework and industry projects spanning classical ML, natural-language processing, network science, and production-grade automation tooling.

Built by **Me** in for different purposes, projects, tasks.

---

## Skill matrix

| Skill | Where you'll see it |
|-------|---------------------|
| **Classical ML** (decision trees, K-means, hierarchical clustering) | [`coursework/decision-trees`](coursework/decision-trees), [`coursework/clustering`](coursework/clustering), [`coursework/film-trends-analysis`](coursework/film-trends-analysis) |
| **NLP & applied classification** (sentence-transformers, SetFit, LLM prompting, ensembling) | [`industry/email-classification`](industry/email-classification) |
| **Network science** (igraph, Gephi, centrality, homophily, modularity) | [`coursework/friendship-network-analysis`](coursework/friendship-network-analysis), [`coursework/film-trends-analysis`](coursework/film-trends-analysis) |
| **Association-rule mining** (Apriori, frequent itemsets) | [`coursework/film-trends-analysis`](coursework/film-trends-analysis) |
| **CLI engineering** (Node.js, HTTP clients, command matrices, config) | [`industry/agentic-automation/agent-clis`](industry/agentic-automation/agent-clis) |
| **Agent / skill authoring** (reusable task prompts, MCP integration) | [`industry/agentic-automation/agent-skills`](industry/agentic-automation/agent-skills) |
| **Browser extension** (Chrome Manifest V3) | [`industry/agentic-automation/teams-chat-tool`](industry/agentic-automation/teams-chat-tool) |

## Repository layout

```
ai-ml-learning/
├── coursework/                     # University assignments
│   ├── decision-trees/             #   Forest-type classification (scikit-learn)
│   ├── clustering/                 #   Seeds clustering (K-means + hierarchical)
│   ├── film-trends-analysis/       #   Netflix trends (network + clustering + Apriori)
│   └── friendship-network-analysis/#   igraph network analysis (R + Python)
└── industry/                       # Internship & self-directed work
    ├── email-classification/       #   Email priority triage pipeline (Python ML)
    └── agentic-automation/         #   Automation tooling (Node.js CLIs + Chrome ext)
        ├── agent-clis/             #     Jira / Confluence / GitLab CLI packages
        ├── agent-skills/           #     Reusable agent skills + Docker
        └── teams-chat-tool/        #     Teams chat exporter (Chrome extension)
```

## Highlights

### `email-classification` — priority triage for a government hotline
A modular ensemble pipeline (embedding k-NN + SetFit + LLM) that flags complaint-handling emails needing reassignment. **0.87 H-F1 / 0.94 accuracy** overall on a 262-email evaluation set. Full segmented metrics and architecture in [its README](industry/email-classification/README.md).

### `agent-clis` — rebranded command-line tools for Jira, Confluence, GitLab
Three npm-publishable CLI packages with a shared architecture (HTTP layer, command matrix, config, error/log utilities). See [their READMEs](industry/agentic-automation/agent-clis/).

### `friendship-network-analysis` — graph structure vs. wellbeing
Builds a weighted friendship network from survey data and tests small-world structure, gender homophily, and the correlation between centrality and self-reported wellbeing. Analysis in R/igraph, preprocessing in Python.

## How to run

Each project is self-contained — follow the "Quick start" / "How to run" section in its own README. Highlights:

```bash
# Classical ML (any Python project)
pip install -r <project>/requirements.txt   # or the pip line in its README
python <project>/<script>.py

# Node CLIs
npm install -g ./industry/agentic-automation/agent-clis/agent-jira-cli
jira-cli --help

# Network analysis
# Python preprocessing, then R/igraph analysis — see its README
```

## Provenance

For transparency on which projects are coursework vs. internship vs. self-directed, and notes on anonymised data, see **[PROVENANCE.md](PROVENANCE.md)**.
