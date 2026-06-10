# Dimension — Frontend

Findings rattachés au frontend par **heuristique de chemin** (`.vue`, `.jsx`, `.tsx`,
`components/`, `pages/`, `views/`, `ui/`) appliquée aux résultats de :

| Vérification | Outil |
|---|---|
| Qualité / complexité des composants | **ESLint** |
| (Optionnel) Performance, accessibilité, best-practices runtime | **Lighthouse CI** |

Pondération dans le score global : **8 %**. La narration (rerenders, lazy loading,
bundle, a11y) est produite par Ollama. Lighthouse nécessite une app web buildable
et reste optionnel (désactivé par défaut).
