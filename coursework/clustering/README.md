# Clustering Assignment

Unsupervised-learning coursework: cluster the UCI **Seeds** dataset using hierarchical and K-means methods, then compare the discovered clusters against the true wheat-variety labels.

## Dataset

`seeds_dataset.txt` — 210 wheat kernels described by 7 geometric features (no header; whitespace-separated):

| Feature | Meaning |
|---------|---------|
| `area`, `perimeter` | Kernel size |
| `compactness` | `4π·area / perimeter²` |
| `length_of_kernel`, `width_of_kernel` | Kernel dimensions |
| `asymmetry_coefficient` | Kernel shape asymmetry |
| `length_of_kernel_groove` | Groove length |
| `class_label` | Ground-truth variety (3 classes) |

## Tasks

| File | Task | Method |
|------|------|--------|
| `Task_A_B_heirarchial_clustering.py` | A & B | Hierarchical clustering (single / complete / average linkage), dendrograms, linkage comparison |
| `Task_C_K_means_clustering.py` | C | K-means (K=2, 3) with PCA visualisation |
| `Task_C_K_heirarchial_clustering.py` | C | Hierarchical clustering (K=2, 3) for K-means comparison |
| `Task_D_subset_heirarchial_clustering.py` | D | Hierarchical clustering on two feature subsets |

### Task D subsets

- **Subset 1 — Magnitude & Dimensionality:** `area`, `perimeter`, `length_of_kernel`, `width_of_kernel`.
- **Subset 2 — Dimensionless Form & Proportion:** `compactness`, `asymmetry_coefficient`, `length_of_kernel_groove`.

## Evaluation

Each clustering run writes a **cluster × true-label contingency table** to a CSV, so purity/confusion is inspectable directly:

- `TaskC_KMeans_Results.csv` — K-means K=3 and K=2.
- `TaskC_K2_Hierarchical_Results.csv`, `TaskC_K3_Hierarchical_Results.csv` — hierarchical K=2/3.
- `TaskD_Subset_Evaluation.csv`, `TaskX_Subset_Evaluation.csv` — subset-based runs.

## How to run

```bash
pip install pandas matplotlib scikit-learn scipy
python Task_C_K_means_clustering.py   # e.g. any task script
```

## Key findings

- The 3 true wheat varieties are well-separated in feature space; K-means with K=3 recovers them with high purity.
- Single-linkage is prone to chaining; complete and average linkage produce cleaner, more interpretable dendrograms.
- The dimensionless/proportion subset (Subset 2) alone carries most of the separability — size features (Subset 1) are noisier.
