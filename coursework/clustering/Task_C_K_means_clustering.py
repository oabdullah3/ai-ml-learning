import pandas as pd
import matplotlib.pyplot as plt
from sklearn.cluster import KMeans 
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

file_path = "./seeds_dataset.txt"
df = pd.read_csv(file_path, sep=r'\s+', header=None).dropna(axis=1, how='all')
df.columns = ['area', 'perimeter', 'compactness', 'length_of_kernel', 'width_of_kernel', 'asymmetry_coefficient', 'length_of_kernel_groove', 'class_label']

X = df.drop('class_label', axis=1)
y = df['class_label']

scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)  

pca = PCA(n_components=2)
X_pca = pca.fit_transform(X_scaled)

with open("TaskC_KMeans_Results.csv", "w") as file:
        pass
for k in [3,2]:
    km = KMeans(n_clusters=k, random_state=67) 
    km_labels = km.fit_predict(X_scaled)

    comparison_table = pd.crosstab(
        index=km_labels, 
        columns=y.values, 
        rownames=['Assigned Cluster'], 
        colnames=['True Label']
    )
    with open("TaskC_KMeans_Results.csv", "a") as file:
        file.write(f"CLUSTERING: K-MEANS (K={k})\n")
    comparison_table.to_csv("TaskC_KMeans_Results.csv", mode='a')
    with open("TaskC_KMeans_Results.csv", "a") as file:
        file.write("\n")
