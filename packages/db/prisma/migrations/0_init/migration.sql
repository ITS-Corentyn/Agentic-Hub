-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('queued', 'running', 'analyzing', 'done', 'failed');

-- CreateEnum
CREATE TYPE "AuditTrigger" AS ENUM ('manual', 'schedule', 'ci');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('critical', 'high', 'medium', 'low', 'info');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('open', 'fixed', 'ignored');

-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "githubId" BIGINT,
    "fullName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "url" TEXT,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "language" TEXT,
    "private" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "lastAuditAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Audit" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "status" "AuditStatus" NOT NULL DEFAULT 'queued',
    "trigger" "AuditTrigger" NOT NULL DEFAULT 'manual',
    "commitSha" TEXT,
    "globalScore" DOUBLE PRECISION,
    "loc" INTEGER NOT NULL DEFAULT 0,
    "files" INTEGER NOT NULL DEFAULT 0,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "toolsRun" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "toolsSkipped" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DimensionResult" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "counts" JSONB NOT NULL,

    CONSTRAINT "DimensionResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "ruleId" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "filePath" TEXT,
    "line" INTEGER,
    "remediation" TEXT NOT NULL DEFAULT '',
    "reference" TEXT,
    "fingerprint" TEXT NOT NULL,
    "status" "FindingStatus" NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Synthesis" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "executiveSummary" TEXT NOT NULL,
    "top10" JSONB NOT NULL,
    "roadmap7d" JSONB NOT NULL,
    "roadmap30d" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "llmGenerated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Synthesis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanArtifact" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "rawOutput" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "scoring" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Repository_githubId_key" ON "Repository"("githubId");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_fullName_key" ON "Repository"("fullName");

-- CreateIndex
CREATE INDEX "Repository_owner_idx" ON "Repository"("owner");

-- CreateIndex
CREATE INDEX "Audit_repositoryId_createdAt_idx" ON "Audit"("repositoryId", "createdAt");

-- CreateIndex
CREATE INDEX "Audit_status_idx" ON "Audit"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DimensionResult_auditId_dimension_key" ON "DimensionResult"("auditId", "dimension");

-- CreateIndex
CREATE INDEX "Finding_auditId_severity_idx" ON "Finding"("auditId", "severity");

-- CreateIndex
CREATE INDEX "Finding_auditId_dimension_idx" ON "Finding"("auditId", "dimension");

-- CreateIndex
CREATE INDEX "Finding_fingerprint_idx" ON "Finding"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "Synthesis_auditId_key" ON "Synthesis"("auditId");

-- CreateIndex
CREATE INDEX "ScanArtifact_auditId_idx" ON "ScanArtifact"("auditId");

-- AddForeignKey
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DimensionResult" ADD CONSTRAINT "DimensionResult_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Synthesis" ADD CONSTRAINT "Synthesis_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanArtifact" ADD CONSTRAINT "ScanArtifact_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

