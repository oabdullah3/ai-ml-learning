"""K-means clustering of Netflix films/TV shows by genre, IMDb score and runtime.

Determines the optimal cluster count with the elbow method, clusters the
titles, and reports cluster sizes, per-cluster top genres, and a 2-D PCA view.

Usage:
    python kmeans-clustering.py [--k N]
"""

import argparse
import ast
from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd
import seaborn as sns
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.preprocessing import MultiLabelBinarizer, StandardScaler

DATA_DIR = Path(__file__).resolve().parent / "data"


def parse_genres(value):
    """Parse a genre list literal (e.g. \"['drama', 'action']\")."""
    try:
        return ast.literal_eval(value)
    except (ValueError, SyntaxError):
        return []


def load():
    titles = pd.read_csv(DATA_DIR / "titles.csv")
    titles["runtime"] = titles["runtime"].fillna(titles["runtime"].median())
    titles["imdb_score"] = titles["imdb_score"].fillna(titles["imdb_score"].median())
    titles["genres"] = titles["genres"].apply(parse_genres)
    return titles


def build_features(titles):
    mlb = MultiLabelBinarizer()
    genre_encoded = pd.DataFrame(
        mlb.fit_transform(titles["genres"]),
        columns=mlb.classes_,
        index=titles.index,
    )
    features = pd.concat([titles[["imdb_score"]], genre_encoded], axis=1)
    return features.select_dtypes(include="number").fillna(0), mlb


def plot_elbow(scaled, k_max=10):
    sse = {}
    for k in range(1, k_max + 1):
        model = KMeans(n_clusters=k, random_state=42, n_init=10)
        model.fit(scaled)
        sse[k] = model.inertia_

    plt.figure(figsize=(10, 6))
    plt.plot(list(sse.keys()), list(sse.values()), marker="o", linestyle="--")
    plt.xlabel("Number of Clusters (k)")
    plt.ylabel("SSE (Sum of Squared Errors)")
    plt.title("Elbow Method for Optimal K")
    plt.xticks(list(sse.keys()))
    plt.grid(True)
    plt.show()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--k", type=int, default=4,
                        help="Cluster count (inspect the elbow plot first).")
    args = parser.parse_args()

    titles = load()
    features, mlb = build_features(titles)

    scaler = StandardScaler()
    scaled = scaler.fit_transform(features)

    plot_elbow(scaled)

    model = KMeans(n_clusters=args.k, random_state=42, n_init=10)
    titles["cluster"] = model.fit_predict(scaled)

    print(f"\nCluster sizes (k={args.k}):")
    print(titles["cluster"].value_counts().sort_index().to_string())

    centers = pd.DataFrame(
        scaler.inverse_transform(model.cluster_centers_),
        columns=features.columns,
    )

    print("\nTop genres per cluster:")
    for i in range(args.k):
        top = centers.iloc[i][mlb.classes_].sort_values(ascending=False).head(5)
        print(f"  Cluster {i}: avg IMDb {centers.loc[i, 'imdb_score']:.2f} | "
              f"{', '.join(top.index)}")

    pca = PCA(n_components=2)
    pc = pca.fit_transform(scaled)
    plot_df = pd.DataFrame(pc, columns=["PC1", "PC2"])
    plot_df["cluster"] = titles["cluster"].values

    sns.scatterplot(x="PC1", y="PC2", hue="cluster", data=plot_df,
                    palette="viridis", s=50, alpha=0.7)
    plt.title("2-D PCA of Film/TV Clusters")
    plt.xlabel("Principal Component 1")
    plt.ylabel("Principal Component 2")
    plt.legend(title="Cluster")
    plt.grid(True)
    plt.show()


if __name__ == "__main__":
    main()
