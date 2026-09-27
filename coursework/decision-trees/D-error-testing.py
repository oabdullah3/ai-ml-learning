import pandas as pd
from sklearn import tree

data = pd.read_csv('training.csv',header='infer')
test_data = pd.read_csv('testing.csv',header='infer')
Y_train = data['class']
X_train = data.drop('class', axis=1)
Y_test = test_data['class']
X_test = test_data.drop('class', axis=1)

clf = tree.DecisionTreeClassifier(max_depth=2, random_state=42)
clf.fit(X_train, Y_train)
Y_pred = clf.predict(X_test)

analysis_df = X_test.copy()

analysis_df['True_Class'] = Y_test.astype(str).str.strip()
analysis_df['Predicted_Class'] = pd.Series(Y_pred).astype(str).str.strip()

print("Unique True Classes found:", analysis_df['True_Class'].unique())
print("Unique Predicted Classes found:", analysis_df['Predicted_Class'].unique(), "\n")

error_h_as_s = analysis_df[(analysis_df['True_Class'] == 'h') & (analysis_df['Predicted_Class'] == 's')]
correct_h = analysis_df[(analysis_df['True_Class'] == 'h') & (analysis_df['Predicted_Class'] == 'h')]
correct_s = analysis_df[(analysis_df['True_Class'] == 's') & (analysis_df['Predicted_Class'] == 's')]

error_d_as_s = analysis_df[(analysis_df['True_Class'] == 'd') & (analysis_df['Predicted_Class'] == 's')]
correct_d = analysis_df[(analysis_df['True_Class'] == 'd') & (analysis_df['Predicted_Class'] == 'd')]

features_to_check = ['b2', 'pred_minus_obs_H_b1']

print("=== Error Case 1: True 'h' predicted as 's' ===")
print("Misclassified 'h' averages:\n", error_h_as_s[features_to_check].mean())
print("\nCorrectly classified 'h' averages:\n", correct_h[features_to_check].mean())
print("\nCorrectly classified 's' averages:\n", correct_s[features_to_check].mean())

print("\n--------------------------------------------------\n")

print("=== Error Case 2: True 'd' predicted as 's' ===")
print("Misclassified 'd' averages:\n", error_d_as_s[features_to_check].mean())
print("\nCorrectly classified 'd' averages:\n", correct_d[features_to_check].mean())