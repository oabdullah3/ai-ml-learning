import pandas as pd
import matplotlib.pyplot as plt
from scipy.cluster.hierarchy import dendrogram, linkage
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

for i, method in enumerate(methods):
    plt.figure(figsize=(25, 10))
    Z = linkage(X_scaled, method=method)
    dendrogram(Z)
    
    plt.title(f"Dendrogram: {titles[i]}")
    plt.xlabel("Data Points (Indices)")
    plt.ylabel("Merge Distance")
    
    plt.show()