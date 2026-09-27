import pandas as pd

# Load the Excel file
file_path = 'pre_edge_list.xlsx'  # Replace with your file path
df = pd.read_excel(file_path)

# Initialize an empty list to store the edge list
edge_list = []

# Iterate through each row in the DataFrame
for _, row in df.iterrows():
    source_node = row['Name']  # Adjust column name if necessary
    for i in range(1, 7, 2):  # Assuming Node 1, Node 2, Node 3 are in columns 1, 3, 5
        target_node = row[i]  # Node column
        weight = row[i + 1]  # Weight column
        if pd.notna(target_node) and pd.notna(weight):  # Check for non-null values
            edge_list.append([source_node, target_node, weight])

# Create a new DataFrame for the edge list
edge_df = pd.DataFrame(edge_list, columns=['Source Node', 'Target Node', 'Weight'])

# Save the edge list to a new Excel or CSV file
edge_df.to_csv('edge_list_csv.csv', index=False)  # Save as CSV
# or
edge_df.to_excel('edge_list_excel.xlsx', index=False)  # Save as Excel'
