# Dimension — Sécurité

Audit **déterministe** (plus de LLM payant). Outils open-source utilisés :

| Vérification | Outil |
|---|---|
| SAST (XSS, SQLi, SSRF, injection de commandes, désérialisation…) | **Semgrep** (`--config auto`) |
| Secrets / credentials exposés | **Gitleaks**, **Trivy** (secret) |
| Dépendances vulnérables | **Trivy** (vuln), **OSV-Scanner**, **npm audit** |
| Mauvaises configurations (IaC, Dockerfile…) | **Trivy** (misconfig) |
| Code dangereux (`eval`, `Function`…) | **ESLint** (règles sécurité) |

Chaque finding porte : criticité, fichier, ligne, description, **correctif** et référence.
Score sécurité /100 = `100 − pénalités pondérées par sévérité` (normalisé par la taille du code).
Pondération de la dimension dans le score global : **30 %**.
