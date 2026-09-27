import pandas as pd
import matplotlib.pyplot as plt
from scipy.cluster.hierarchy import linkage, dendrogram, fcluster
from sklearn.preprocessing import StandardScaler

# 1. Load data
file_path = "./seeds_dataset.txt"
df = pd.read_csv(file_path, sep=r'\s+', header=None).dropna(axis=1, how='all')
df.columns = ['area', 'perimeter', 'compactness', 'length_of_kernel', 'width_of_kernel', 'asymmetry_coefficient', 'length_of_kernel_groove', 'class_label']
y = df['class_label']

# 2. Define our two subsets
subsets = {
    "Subset 1 (Magnitude and Dimensionality)": ['area', 'perimeter', 'length_of_kernel', 'width_of_kernel'],
    "Subset 2 (Dimensionless Form and Proportion)": ['compactness', 'asymmetry_coefficient', 'length_of_kernel_groove']
}

methods = ['single', 'complete', 'average']
method_titles = ['Single Link (MIN)', 'Complete Link (MAX)', 'Group Average']

csv_output = "TaskX_Subset_Evaluation.csv"

# 3. Open CSV in 'w' mode to initialize and clear the file
with open(csv_output, "w") as file:
    pass 

for title, columns in subsets.items():
    # Isolate and scale the subset
    X_subset = df[columns]
    X_scaled = StandardScaler().fit_transform(X_subset)
    
    # Write subset header to CSV
    with open(csv_output, "a") as file:
        file.write(f"============================================================\n")
        file.write(f" EVALUATION FOR: {title.upper()} \n")
        file.write(f"============================================================\n\n")
    
    for i, method in enumerate(methods):
        # Perform clustering
        Z = linkage(X_scaled, method=method)
        
        # --- 1. PLOT DENDROGRAM (SEPARATE PLOT PER METHOD) ---
        # figsize=(18, 5) makes it wide but short!
        plt.figure(figsize=(18, 5)) 
        
        dendrogram(Z, leaf_rotation=90, leaf_font_size=8)
        
        # Combine the subset and method into one clean title
        plt.title(f"{title}\nMethod: {method_titles[i]}", fontsize=14, fontweight='bold')
        plt.xlabel("Data Points (Indices)", fontsize=12)
        plt.ylabel("Merge Distance", fontsize=12)
        
        # tight_layout works flawlessly on single plots
        plt.tight_layout()
        plt.show()
        
        # --- 2. EXTRACT LABELS & GENERATE TABLE ---
        kclusters = fcluster(Z, 3, criterion='maxclust')
        
        comparison_table = pd.crosstab(
            index=kclusters, 
            columns=y.values, 
            rownames=['Assigned Cluster'], 
            colnames=['True Label']
        )
        
        # --- 3. SAVE TO CSV ---
        with open(csv_output, "a") as file:
            file.write(f"METHOD: {method_titles[i]}\n")
            
        comparison_table.to_csv(csv_output, mode='a')
        
        with open(csv_output, "a") as file:
            file.write("\n")

print("--> Successfully saved all cross-tabulations to 'TaskD_Subset_Evaluation.csv'")