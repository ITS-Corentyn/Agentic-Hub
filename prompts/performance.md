# Dimension — Performance

Audit **déterministe** des signaux de performance statiques :

| Vérification | Outil |
|---|---|
| Complexité cyclomatique, profondeur, fonctions trop longues | **ESLint** (`complexity`, `max-depth`, `max-lines-per-function`…) |
| Modules trop couplés (impact bundle / chargement) | **madge** |
| (Optionnel) Métriques runtime (LCP, TBT…) | **Lighthouse CI** |

Pondération dans le score global : **7 %**. Les findings de complexité issus d'ESLint
sont classés en dimension *performance*. La narration et le classement par sévérité
(Critique/Haute/Moyenne/Faible) sont produits par Ollama.
