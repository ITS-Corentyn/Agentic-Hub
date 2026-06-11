-- URL optionnelle pour l'audit Lighthouse (perf/a11y/SEO) d'une app web déployée.
ALTER TABLE "Repository" ADD COLUMN "lighthouseUrl" TEXT;
