# Dimension — Backend

Findings rattachés au backend par **heuristique de chemin** (`server/`, `api/`, `routes/`,
`controllers/`, `services/`, `prisma/`, `*.server.*`) appliquée aux résultats de :

| Vérification | Outil |
|---|---|
| Motifs dangereux côté serveur (injection, endpoints risqués) | **Semgrep** |
| Complexité / qualité des modules serveur | **ESLint** |

Pondération dans le score global : **10 %**. La narration (endpoints sensibles, requêtes,
N+1) est produite par Ollama à partir des findings collectés.
