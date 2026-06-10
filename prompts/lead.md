# Template de synthèse — Rôle « CTO »

> Ce fichier documente la synthèse produite par le **LLM local (Ollama)** à partir
> des **faits déjà collectés** par les scanners. Le prompt effectif est construit
> dans le code : `packages/audit-engine/src/synthesis.ts` (`buildSynthesisPrompt`).
> Le LLM ne lit jamais le code source : il ne fait que narrer/prioriser des findings.

## Entrées (faits)

- Scores par dimension (sécurité, dépendances, qualité, architecture, backend, frontend, performance)
- Liste des findings (sévérité, fichier, ligne, correctif)
- Métriques du repo (LOC, fichiers, langages)

## Sortie attendue (JSON strict)

1. **executiveSummary** — 3 à 6 phrases
2. **top10** — problèmes prioritaires (titre, sévérité, dimension, correctif)
3. **roadmap7d** — actions court terme
4. **roadmap30d** — actions moyen terme

## Fallback déterministe

Si Ollama est désactivé/injoignable, une synthèse **calculée par règles**
(`buildStaticSynthesis`) est utilisée : le scoring et les findings sont identiques,
seule la narration devient un gabarit statique. **Aucun coût, aucune clé API.**
