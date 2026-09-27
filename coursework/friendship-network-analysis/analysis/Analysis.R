el <- read.csv("edge_list_csv_forR.csv")
attr <- read.csv("node_attribute_List_forR.csv")
# examine your data
head(el)
library(igraph)
# converting the raw data to an igraph network object
# Here we use igraphs graph.data.frame function, which 
# combines two data frames: d and vertices.
g <- graph.data.frame(d = el,vertices = attr, directed=F)
list.vertex.attributes(g)


####Global-level metrics-----------------------------------------------
#Calculate N of nodes
vcount(g)

#Calculate N of edges
ecount(g)

#Mean and median degree
#degree(g)
mean(degree(g))
median(degree(g))

#Density and reciprocity
graph.density(g)
#reciprocity(g) #for directed network

#diameter of a network
is.connected(g)
is.directed(g)
diameter(g)

#Average path length
mean_distance(g, directed=F) #for undirected network

####Individual-level metrics-------------------------------------------
#Degree centrality
E(g)$Weight <- el$Weight
deg <- degree(g)
wdeg <- strength(g, mode = "all")

#A histogram is a graph used to represent the frequency distribution
hist(deg,breaks=50)

#indegree and outdegree for directed network
#V(g)$outdegree = degree(g,mode="out") #for directed network
#V(g)$indegree = degree(g,mode="in") #for directed network
#Closeness centrality
close <- closeness(g, mode="all", normalized=T)
#Betweenness centrality
bet <- betweenness(g, normalized=T)
hist(bet)
# Eigenvector centrality 
eigen <- evcent(g)$vector
#local clustering coefficient
cc <- transitivity(g, type="local")

#save all the data
attr_updated <- data.frame(row.names = V(g)$name,
                   degree = deg,
                   weighted_degree = wdeg,
                   betweenness = bet,
                   closeness = close,
                   eigenvector = eigen,
                   clutering_coefficient = cc,
                   stress = attr$stress.level,
                   loneliness = attr$loneliness.level,
                   mentalhealth = attr$mental.health.score
                   )

colnames(attr_updated)

attr_updated$mentalhealth <- as.numeric(trimws(attr_updated$mentalhealth))
attr_updated$loneliness <- as.numeric(trimws(attr_updated$loneliness))
attr_updated$stress <- as.numeric(trimws(attr_updated$stress))
attr_clean <- na.omit(attr_updated[, c("degree", "weighted_degree", "clutering_coefficient" ,"mentalhealth", "betweenness", "loneliness", "stress")])

cor(attr_updated)
cor.test(attr_updated$degree,attr_updated$mentalhealth)
cor.test(attr_updated$weighted_degree,attr_updated$mentalhealth)
cor.test(attr_updated$betweenness,attr_updated$mentalhealth)
cor.test(attr_updated$degree,attr_updated$stress)
cor.test(attr_updated$degree,attr_updated$loneliness)

#######################################################################
####                 power law distribution                        ####
#######################################################################
#the degree distribution of the network will follow a power law distribution
freq <- table(deg) #return you with the frequency of degrees
plot(freq, type = "p")

df <- as.data.frame(freq,stringsAsFactors = F)
plot(Freq~deg, data=df, type = "p", log = "xy", main = "Log-log Plot")

#######################################################################
####                         Homophily                             ####
#######################################################################
#using the function assortativity in igraph to test  homophily
assortativity(g, as.factor(V(g)$gender)) #for categorical variable

#######################################################################
####           check the small world phenomenon                    ####
#######################################################################
giant <- decompose(g)[[1]]
diameter(giant)
mean_distance(giant)
transitivity(g, type = "average")

