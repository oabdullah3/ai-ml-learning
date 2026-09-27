import pandas as pd
from scipy.cluster.hierarchy import linkage, fcluster
from sklearn.preprocessing import StandardScaler

file_path = "./seeds_dataset.txt"
df = pd.read_csv(file_path, sep=r'\s+', header=None).dropna(axis=1, how='all')
df.columns = ['area', 'perimeter', 'compactness', 'length_of_kernel', 'width_of_kernel', 'asymmetry_coefficient', 'length_of_kernel_groove', 'class_label']

X = df.drop('class_label', axis=1)
y = df['class_label']

scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)  

methods = ['single', 'complete', 'average']
titles = ['Single Link (MIN)', 'Complete Link (MAX)', 'Group Average']

for k in [3,2]:
    with open(f"TaskC_K{k}_Hierarchical_Results.csv", "w") as file:
        pass
    for i, method in enumerate(methods):
        Z = linkage(X_scaled, method=method)
        kclusters = fcluster(Z, k, criterion='maxclust')
        comparison_table = pd.crosstab(
            index=kclusters, 
            columns=y.values, 
            rownames=['Assigned Cluster'], 
            colnames=['True Label']
        )
        with open(f"TaskC_K{k}_Hierarchical_Results.csv", "a") as file:
            file.write(f"CLUSTERING: {titles[i].upper()}\n")
        comparison_table.to_csv(f"TaskC_K{k}_Hierarchical_Results.csv", mode='a')
        with open(f"TaskC_K{k}_Hierarchical_Results.csv", "a") as file:
            file.write("\n")

