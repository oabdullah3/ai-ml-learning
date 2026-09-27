import pandas as pd
import numpy as np

# Load the CSV data
data = pd.read_csv('Attributes.csv')

# Filter out rows without gender or mental health score
filtered_data = data #dropna(subset=['gender', 'mental health score'])

def normalize(series):
    """Normalize a Pandas Series to a range of 0 to 1."""
    return (series - series.min()) / (series.max() - series.min())

# Function to calculate adjusted mental health score, loneliness level, and stress level
def calculate_scores(row,weighted_degree_max,betweenness_max, degree_max):
    # Extract relevant values
    adjusted_score = row['mental health score']

    # Check if gender or mental health score is missing
    if pd.isna(row['gender']) or pd.isna(row['mental health score']):
        # Assign 0 values if gender or mental health score is missing
        adjusted_score = None
        loneliness_level = None
        stress_level = None
    else:
        # # Normalize weighted degree and betweenness centrality
        # normalized_weighted_degree = weighted_degree / weighted_degree_max if weighted_degree_max > 0 else 0
        # normalized_betweenness = betweenness / betweenness_max if betweenness_max > 0 else 0
        # normalized_degree = degree / degree_max if degree_max > 0 else 0
        # average_degree = (normalized_weighted_degree * 0.3) + (normalized_degree * 0.7)
        # # Emphasize weighted degree and reduce betweenness centrality influence
        # degree_weight = 4  # Increase this coefficient to amplify the effect of weighted degree
        # betweenness_weight = 0.25  # Decrease this coefficient to reduce the effect of betweenness
        # # Apply transformations
        # adjusted_score = (degree_weight * average_degree) - \
        #                     (betweenness_weight * np.log1p(normalized_betweenness))
        # Add randomness for variability
        noise = np.random.normal(0, 1)  # Reduced noise for stability
        # adjusted_score += noise
        # # Normalize the score to a reasonable range (1-5)
        # adjusted_score = np.clip(adjusted_score * 5, 1, 5)  # Scale to 1-5
        # Calculate loneliness level
        loneliness_level = 6 - adjusted_score + noise  # Inversely related but non-linear
        loneliness_level = np.clip(loneliness_level, 1, 5)  # Ensure it's in the range 1-5
        # Calculate stress level
        stress_level = (6 - adjusted_score) ** (np.random.normal(0, 10) / 10)
        stress_level -= noise # Non-linear relationship
        stress_level = np.clip(stress_level, 1, 5)  # Ensure it's in the range 1-5
    
    return pd.Series([adjusted_score, loneliness_level, stress_level])

# Apply the function to each row and create new columns
# Calculate maximum values for normalization
weighted_degree_max = filtered_data['Weighted Degree'].max()
betweenness_max = filtered_data['betweenesscentrality'].max()
degree_max = filtered_data['Degree'].max()
filtered_data[['Adjusted Mental Health Score', 'Loneliness Level', 'Stress Level']] = filtered_data.apply(calculate_scores, axis=1, args=(weighted_degree_max, betweenness_max, degree_max))

# Function to scale values to the range 1-5
def scale_to_1_5(series):
        #min_val = series.min()
        #max_val = series.max()
        return round(series)#round(1 + 4 * (series - min_val) / (max_val - min_val))

# Scale the new columns
filtered_data['Adjusted Mental Health Score'] = scale_to_1_5(filtered_data['Adjusted Mental Health Score'])
filtered_data['Loneliness Level'] = scale_to_1_5(filtered_data['Loneliness Level'])
filtered_data['Stress Level'] = scale_to_1_5(filtered_data['Stress Level'])

# Save the updated DataFrame to a new Excel file
output_file = 'New_Processed_Network_Attributes.xlsx'
filtered_data.to_excel(output_file, index=False)

print(f"Data has been saved to {output_file}")