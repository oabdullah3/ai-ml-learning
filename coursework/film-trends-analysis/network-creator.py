"""Build a co-starring network of frequent actors for import into Gephi.

Loads credits.csv and titles.csv, keeps actors with >= 5 credits, and produces
Gephi-ready node and edge tables under `network/`:
  - nodes.csv : actor id, label, roles, top/all production countries.
  - edges.csv : undirected co-appearance edges weighted by shared titles.

Usage:
    python network-creator.py
"""

import ast
import itertools
from collections import Counter
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
OUT_DIR = ROOT / "network"

MIN_MOVIES_PER_ACTOR = 5


def parse_countries(value):
    try:
        return ast.literal_eval(str(value))
    except (ValueError, SyntaxError):
        return []


def top_countries(counter):
    if not counter:
        return "Unknown"
    mx = max(counter.values())
    return ",".join(sorted(c for c, n in counter.items() if n == mx))


def all_countries(countries):
    return ",".join(countries) if countries else "Unknown"


def main():
    credits = pd.read_csv(DATA_DIR / "credits.csv").dropna(
        subset=["person_id", "id", "role"])
    credits["person_id"] = credits["person_id"].astype(str)
    credits["id"] = credits["id"].astype(str)

    counts = credits.groupby("person_id")["id"].nunique()
    frequent = credits[
        credits["person_id"].isin(counts[counts >= MIN_MOVIES_PER_ACTOR].index)
    ]

    # --- Nodes ---
    nodes = (
        frequent.groupby("person_id")
        .agg(
            name=("name", "first"),
            role=("role", lambda s: ",".join(sorted(set(s)))),
        )
        .reset_index()
        .rename(columns={"person_id": "Id", "name": "Label", "role": "Role"})
    )

    titles = pd.read_csv(DATA_DIR / "titles.csv")
    titles["id"] = titles["id"].astype(str)
    titles["production_countries"] = titles["production_countries"].apply(
        parse_countries)

    merged = frequent.merge(
        titles[["id", "production_countries"]], on="id", how="left")

    country_data = (
        merged.groupby("person_id")["production_countries"]
        .agg(lambda series: {
            "top": Counter(c for cs in series if isinstance(cs, list) for c in cs),
            "all": sorted({c for cs in series if isinstance(cs, list) for c in cs}),
        })
        .reset_index()
    )
    country_data["TopCountry"] = country_data["production_countries"].apply(
        lambda d: top_countries(d["top"]))
    country_data["AllCountries"] = country_data["production_countries"].apply(
        lambda d: all_countries(d["all"]))

    nodes = (
        nodes.merge(
            country_data[["person_id", "TopCountry", "AllCountries"]],
            left_on="Id", right_on="person_id", how="left")
        .drop(columns="person_id")
    )
    nodes["TopCountry"] = nodes["TopCountry"].fillna("Unknown")
    nodes["AllCountries"] = nodes["AllCountries"].fillna("Unknown")

    # --- Edges ---
    edges = []
    for _, group in frequent.groupby("id")["person_id"]:
        for a, b in itertools.combinations(group, 2):
            edges.append({"Source": a, "Target": b, "Weight": 1})

    edges = (
        pd.DataFrame(edges)
        .groupby(["Source", "Target"], as_index=False)["Weight"].sum()
    )
    edges["Type"] = "Undirected"

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    nodes.to_csv(OUT_DIR / "nodes.csv", index=False)
    edges.to_csv(OUT_DIR / "edges.csv", index=False)
    print(f"Nodes: {len(nodes)} -> {OUT_DIR / 'nodes.csv'}")
    print(f"Edges: {len(edges)} -> {OUT_DIR / 'edges.csv'}")


if __name__ == "__main__":
    main()
