# Film & TV Trends Analysis

Coursework project that mines a public **Netflix films & TV shows** corpus with three unsupervised-learning techniques: network analysis, clustering, and association-rule mining.

## What it does

Using the Netflix `titles` + `credits` dataset (~5,490 titles, ~77,000 cast credits), the project asks *what patterns drive the streaming catalogue*:

| Technique | Question | Tooling |
|-----------|----------|---------|
| **Network analysis** | Who co-stars together, and who is most central? | Python → Gephi (`igraph`-style centrality) |
| **Clustering** | What natural genre/quality clusters do titles fall into? | `sklearn` K-means + elbow method |
| **Association rules** | Which actors, genres, or actor↔genre combos co-occur unusually often? | `mlxtend` Apriori |

## Dataset

Public Netflix metadata — no privacy concerns:

- `data/titles.csv` — title, type, description, runtime, genres, production countries, IMDb score/votes.
- `data/credits.csv` — per-title cast & crew (person id, name, character, role).

Source: Kaggle's *Netflix Movies and TV Shows* (TMDB-derived).

## Project structure

```
film-trends-analysis/
├── data/
│   ├── titles.csv                 # title metadata
│   └── credits.csv                # cast & crew
├── network-creator.py             # build Gephi node/edge tables
├── kmeans-clustering.py           # cluster titles (K-means + elbow)
├── frequent-patterns.py           # Apriori itemsets + association rules
└── results/
    ├── network_analysis.csv          # Gephi centrality + modularity output
    ├── actor_clusters.csv            # actor → cluster assignment
    ├── frequent_genre_itemsets.csv   # genre co-occurrence (Apriori)
    ├── frequent_actor_genre_itemsets.csv  # actor + genre co-occurrence
    ├── association_rules.csv         # actor association rules
    └── images/                       # exported network visualisations
```

## How to run

```bash
pip install pandas scikit-learn matplotlib seaborn mlxtend

python network-creator.py        # -> network/nodes.csv, network/edges.csv
python kmeans-clustering.py      # -> interactive elbow + PCA plots
python kmeans-clustering.py --k 5
python frequent-patterns.py actors
python frequent-patterns.py genres
python frequent-patterns.py actor-genre
python frequent-patterns.py rules
```

> `network-creator.py` emits Gephi-ready tables; the centrality/modularity analysis itself was done in **Gephi** (a GUI tool) and exported to `results/network_analysis.csv` and `results/images/*.png`.

## Key findings

- **Network:** the co-starring network is dominated by a small set of highly-connected "hub" actors; degree/betweenness are heavily skewed (many bit-part actors, few super-connectors).
- **Clustering:** titles separate cleanly by genre family (documentary vs. drama vs. comedy/action), with IMDb score and runtime providing secondary signal; the elbow suggests ~4–5 clusters.
- **Association rules:** strong genre pairings (`documentation`+`sport`, `music`+`documentation`) and recurring actor ensembles (notably the Sandler family) surface as high-confidence, high-lift rules.

## Provenance

University coursework (data-analytics module). The dataset is entirely public Netflix/TMDB metadata; no client or personal data is involved.
