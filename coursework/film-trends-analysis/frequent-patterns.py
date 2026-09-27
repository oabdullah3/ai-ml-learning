"""Frequent-pattern & association-rule mining on the Netflix film/TV corpus.

Consolidates four formerly separate scripts into one CLI. Every mode builds
market-basket-style transactions from `data/titles.csv` and `data/credits.csv`,
runs the Apriori algorithm (mlxtend), and writes a results CSV to `results/`.

Modes
-----
actors      Frequent actor co-occurrence itemsets (>= 2 actors; maximal only).
genres      Frequent genre-combination itemsets (maximal only).
actor-genre Frequent actor + genre itemsets (>= 2 items; maximal only).
rules       Association rules between actors (confidence >= 0.5, lift >= 1.5).

Examples
--------
    python frequent-patterns.py actors
    python frequent-patterns.py rules
"""

import argparse
import ast
from pathlib import Path

import pandas as pd
from mlxtend.frequent_patterns import apriori, association_rules
from mlxtend.preprocessing import TransactionEncoder

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
RESULTS_DIR = ROOT / "results"

MIN_SUPPORT = 0.002          # ~11 movies in a ~5,490-title corpus
MIN_MOVIES_PER_ACTOR = 5     # drop one-off actors to keep the matrix tractable
MIN_CONFIDENCE = 0.5
MIN_LIFT = 1.5


def parse_list(value):
    """Parse a Python list literal (e.g. \"['drama', 'action']\") safely."""
    try:
        return ast.literal_eval(value)
    except (ValueError, SyntaxError):
        return []


def load_credits():
    df = pd.read_csv(DATA_DIR / "credits.csv").dropna(subset=["person_id", "id"])
    df["person_id"] = df["person_id"].astype(str)
    df["id"] = df["id"].astype(str)
    return df


def load_titles():
    df = pd.read_csv(DATA_DIR / "titles.csv").dropna(subset=["id", "genres"])
    df["id"] = df["id"].astype(str)
    df["genres"] = df["genres"].apply(parse_list)
    return df


def keep_frequent_actors(df, min_movies=MIN_MOVIES_PER_ACTOR):
    counts = df.groupby("person_id")["id"].nunique()
    return df[df["person_id"].isin(counts[counts >= min_movies].index)]


def to_sparse_matrix(transactions):
    te = TransactionEncoder()
    te_ary = te.fit(transactions).transform(transactions, sparse=True)
    return pd.DataFrame.sparse.from_spmatrix(te_ary, columns=te.columns_)


def maximal_itemsets(fi):
    """Keep only itemsets that are not a subset of any larger frequent itemset."""
    items = fi["itemsets"].tolist()
    is_max = [
        not any(it != other and it.issubset(other) for other in items)
        for it in items
    ]
    return fi[is_max].copy()


def format_itemset(itemset, id_to_name=None):
    if id_to_name:
        return ", ".join(id_to_name.get(str(i), str(i)) for i in itemset)
    return ", ".join(str(i) for i in itemset)


def write_result(df, name):
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    path = RESULTS_DIR / name
    df.to_csv(path, index=False)
    print(f"Saved {len(df)} rows -> {path}")


def actor_names(df):
    return (df[["person_id", "name"]]
            .drop_duplicates()
            .set_index("person_id")["name"]
            .to_dict())


def mode_actors():
    df = keep_frequent_actors(load_credits())
    transactions = df.groupby("id")["person_id"].apply(list).tolist()
    fi = apriori(to_sparse_matrix(transactions),
                 min_support=MIN_SUPPORT, use_colnames=True)
    fi = maximal_itemsets(fi[fi["itemsets"].apply(len) >= 2])
    id_to_name = actor_names(df)
    out = pd.DataFrame({
        "itemset": fi["itemsets"].apply(format_itemset, id_to_name=id_to_name),
        "support": fi["support"].values,
        "num_movies": (fi["support"] * len(transactions)).astype(int).values,
    })
    write_result(out, "frequent_actor_itemsets.csv")


def mode_genres():
    titles = load_titles()
    titles = titles[titles["genres"].apply(len) > 0]
    transactions = titles["genres"].tolist()
    fi = apriori(to_sparse_matrix(transactions),
                 min_support=MIN_SUPPORT, use_colnames=True)
    fi = maximal_itemsets(fi)
    out = pd.DataFrame({
        "itemset": fi["itemsets"].apply(format_itemset),
        "support": fi["support"].values,
        "num_movies": (fi["support"] * len(transactions)).astype(int).values,
    })
    write_result(out, "frequent_genre_itemsets.csv")


def mode_actor_genre():
    credits = keep_frequent_actors(load_credits())
    titles = load_titles()[["id", "genres"]]
    merged = credits.merge(titles, on="id", how="inner")
    transactions = merged.groupby("id").apply(
        lambda g: list(g["person_id"]) + g["genres"].iloc[0]
    ).tolist()
    fi = apriori(to_sparse_matrix(transactions),
                 min_support=MIN_SUPPORT, use_colnames=True)
    fi = maximal_itemsets(fi[fi["itemsets"].apply(len) >= 2])
    id_to_name = actor_names(credits)
    out = pd.DataFrame({
        "itemset": fi["itemsets"].apply(format_itemset, id_to_name=id_to_name),
        "support": fi["support"].values,
        "num_movies": (fi["support"] * len(transactions)).astype(int).values,
    })
    write_result(out, "frequent_actor_genre_itemsets.csv")


def mode_rules():
    df = keep_frequent_actors(load_credits())
    transactions = df.groupby("id")["person_id"].apply(list).tolist()
    fi = apriori(to_sparse_matrix(transactions),
                 min_support=MIN_SUPPORT, use_colnames=True)
    rules = association_rules(fi, metric="confidence",
                              min_threshold=MIN_CONFIDENCE)
    rules = rules[rules["lift"] >= MIN_LIFT]
    id_to_name = actor_names(df)
    out = pd.DataFrame({
        "antecedents (actors)": rules["antecedents"].apply(
            format_itemset, id_to_name=id_to_name),
        "consequents (actors)": rules["consequents"].apply(
            format_itemset, id_to_name=id_to_name),
        "support": rules["support"].values,
        "confidence": rules["confidence"].values,
        "lift": rules["lift"].values,
        "conviction": rules["conviction"].values,
        "num_movies": (rules["support"] * len(transactions)).astype(int).values,
    })
    write_result(out, "association_rules.csv")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "mode", choices=["actors", "genres", "actor-genre", "rules"])
    args = parser.parse_args()

    modes = {
        "actors": mode_actors,
        "genres": mode_genres,
        "actor-genre": mode_actor_genre,
        "rules": mode_rules,
    }
    modes[args.mode]()


if __name__ == "__main__":
    main()
