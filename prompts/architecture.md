# Dimension — Architecture

Audit **déterministe** des dépendances et du couplage. Outils open-source :

| Vérification | Outil |
|---|---|
| Dépendances circulaires | **madge** (`--circular`) |
| Violations de couches / dépendances interdites / orphelins | **dependency-cruiser** |
| Duplication de code (signal de mauvaise factorisation) | **jscpd** |

Findings : module(s) concerné(s), description du cycle/violation, **correctif** (extraction d'interface, inversion de dépendance, DRY).
Pondération dans le score global : **15 %**. La narration (cohésion/couplage, dette) est produite par Ollama à partir de ces findings.
