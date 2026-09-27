import pandas as pd
import pydotplus
from sklearn import tree
from sklearn.metrics import accuracy_score
import numpy as np
import matplotlib.pyplot as plt
from sklearn.metrics import confusion_matrix, ConfusionMatrixDisplay

data = pd.read_csv('training.csv',header='infer')
test_data = pd.read_csv('testing.csv',header='infer')
Y_train = data['class']
X_train = data.drop('class', axis=1)
Y_test = test_data['class']
X_test = test_data.drop('class', axis=1)

j = 1
for i in [2,3,4]:
    print(f"## MODEL {j}: MAX-DEPTH={i}\n")
    clf = tree.DecisionTreeClassifier(max_depth=i, random_state=67)
    clf.fit(X_train, Y_train)
    dot_data = tree.export_graphviz(clf, feature_names=X_train.columns, class_names=clf.classes_.astype(str), filled=True, out_file=None) 
    graph = pydotplus.graph_from_dot_data(dot_data) 
    graph.write_png(f"images/model{j}.png")
    print(f"![alt text](images/model{j}.png)\n")
    Y_pred = clf.predict(X_test)
    print(f"### **Overall Classification Accuracy**: {accuracy_score(Y_test, Y_pred):.4f}")
    print(f"### **Complexity**: {str(clf.get_n_leaves())} nodes {str(clf.get_depth())} levels\n")
    cm = confusion_matrix(Y_test, Y_pred)
    # disp = ConfusionMatrixDisplay(confusion_matrix=cm, display_labels=clf.classes_)
    # disp.plot()
    # plt.savefig(f"images/confusion_matrix_model{j}.png", bbox_inches='tight')
    print(f"### Confusion Matrix:\n")
    print(cm)
    #print(f"![alt text](images/confusion_matrix_model{j}.png)\n")
    # plt.close()
    j+=1
    print("---\n")