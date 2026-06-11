-- Gouvernance : planning, politique (gate), override de scoring, notifications.
ALTER TABLE "Repository" ADD COLUMN "auditSchedule" TEXT NOT NULL DEFAULT 'off';
ALTER TABLE "Repository" ADD COLUMN "policy" JSONB;
ALTER TABLE "Repository" ADD COLUMN "scoringOverride" JSONB;

ALTER TABLE "Audit" ADD COLUMN "gatePassed" BOOLEAN;
ALTER TABLE "Audit" ADD COLUMN "gateReasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "Setting" ADD COLUMN "policy" JSONB;
ALTER TABLE "Setting" ADD COLUMN "notify" JSONB;
