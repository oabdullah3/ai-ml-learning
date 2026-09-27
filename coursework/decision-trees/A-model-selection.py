import pandas as pd
from sklearn import tree
from sklearn.metrics import accuracy_score
import numpy as np
import matplotlib.pyplot as plt

data = pd.read_csv('training.csv',header='infer')
test_data = pd.read_csv('testing.csv',header='infer')

Y_train = data['class']
X_train = data.drop('class', axis=1)
Y_test = test_data['class']
X_test = test_data.drop('class', axis=1)

maxdepths = [2,3,4,5,6,7,8,9,10,15,20,25,30,35,40,45,50]

trainAcc = np.zeros(len(maxdepths))
testAcc = np.zeros(len(maxdepths))
actual_depths = np.zeros(len(maxdepths))
leaf_counts = np.zeros(len(maxdepths))


index = 0
for depth in maxdepths:
    clf = tree.DecisionTreeClassifier(max_depth=depth, random_state=67)
    clf = clf.fit(X_train, Y_train)
    Y_predTrain = clf.predict(X_train)
    Y_predTest = clf.predict(X_test)
    trainAcc[index] = accuracy_score(Y_train, Y_predTrain)
    testAcc[index] = accuracy_score(Y_test, Y_predTest)
    actual_depths[index] = clf.get_depth()
    leaf_counts[index] = clf.get_n_leaves()
    index += 1
    
    
#########################################
# Plot 1: Training and Test Accuracies
#########################################
plt.figure(figsize=(8, 5))
plt.plot(maxdepths, trainAcc, 'ro-', label='Training Accuracy')
plt.plot(maxdepths, testAcc, 'bv--', label='Test Accuracy')
plt.legend()
plt.xlabel('Max Depth (Parameter Setting)')
plt.ylabel('Accuracy')
plt.title('Accuracy vs. Max Depth Parameter')
plt.grid(True)
plt.savefig(f"images/dt_accuracy-vs-max-depth.png", bbox_inches='tight')
plt.close()

#########################################
# Plot 2: Actual Tree Depth vs Max Depth
#########################################
plt.figure(figsize=(8, 5))
plt.plot(maxdepths, actual_depths, 'go-')
plt.xlabel('Max Depth (Parameter Setting)')
plt.ylabel('Actual Tree Depth (Levels)')
plt.title('Actual Tree Depth vs. Parameter Setting')
plt.grid(True)
plt.savefig(f"images/dt_levels-vs-max-depth.png", bbox_inches='tight')
plt.close()

#########################################
# Plot 3: Leaf Nodes vs Max Depth
#########################################
plt.figure(figsize=(8, 5))
plt.plot(maxdepths, leaf_counts, 'mo-')
plt.xlabel('Max Depth (Parameter Setting)')
plt.ylabel('Number of Leaf Nodes')
plt.title('Tree Complexity (Leaves) vs. Parameter Setting')
plt.grid(True)
plt.savefig(f"images/dt_leaves-vs-max-depth.png", bbox_inches='tight')
plt.close()