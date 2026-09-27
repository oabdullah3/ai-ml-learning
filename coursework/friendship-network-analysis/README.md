# Friendship Network Analysis

Social-network-analysis coursework: build a weighted, undirected friendship network from survey data and analyse its structure, homophily, and relationship to self-reported wellbeing.

## What it does

1. **Preprocess** raw survey responses into network inputs (edge list + node attributes).
2. **Analyse** the network in R with `igraph` — global metrics, centrality, degree distribution, homophily, and small-world properties.
3. **Relate** network position (degree, weighted degree, betweenness) to wellbeing attributes (mental-health, loneliness, and stress scores).

## Pipeline

```
Attributes.csv ──▶ Convert_To_Edge_List.py ──▶ edge_list CSV
       │                                          │
       ▼                                          ▼
AdjustMentalHealthScores.py ──▶ node attributes ──▶ Analysis.R (igraph)
```

| File | Role |
|------|------|
| `preprocessing/Convert_To_Edge_List.py` | Convert the survey matrix (each person → up to 3 named friends + tie weights) into a `Source, Target, Weight` edge list. |
| `preprocessing/AdjustMentalHealthScores.py` | Derive loneliness and stress scores from the raw mental-health score, normalised to 1–5. |
| `analysis/Analysis.R` | The full `igraph` analysis (see below). |

## Analysis (Analysis.R)

- **Global metrics:** node/edge counts, mean & median degree, density, connectedness, diameter, average path length.
- **Individual centrality:** degree, weighted degree (strength), closeness, betweenness, eigenvector centrality, local clustering coefficient.
- **Power-law check:** log-log degree-frequency plot to test for scale-free behaviour.
- **Homophily:** categorical assortativity by gender.
- **Small-world:** giant-component diameter, mean distance, and average transitivity.
- **Wellbeing correlations:** `cor.test` between degree / weighted degree / betweenness and mental-health, stress, and loneliness.

## Data

The raw survey responses (`Attributes.csv`, the edge-list Excel file, and the derived CSVs) are **not included** — they contain real participants' friendship nominations and wellbeing scores. The scripts accept the original files in-place; see the file references at the top of each script.

## How to run

```bash
# Preprocessing (Python)
pip install pandas openpyxl
python preprocessing/Convert_To_Edge_List.py
python preprocessing/AdjustMentalHealthScores.py

# Analysis (R — open SocialNetsFinalProject.Rproj, then source Analysis.R)
install.packages("igraph")
source("analysis/Analysis.R")
```

## Key findings

- The friendship network exhibits a small-world structure (high clustering with short average path length).
- Degree and weighted degree are weakly but detectably correlated with self-reported wellbeing — social connectivity tracks mental-health scores more strongly than betweenness.
- Gender homophily is present but modest (near-zero assortativity).
