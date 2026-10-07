-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('GITLAB', 'NPM');

-- CreateEnum
CREATE TYPE "CapabilityType" AS ENUM ('MCP', 'SKILL', 'PLUGIN', 'AGENT', 'HOOK', 'POLICY', 'PACK');

-- CreateEnum
CREATE TYPE "CapabilityStatus" AS ENUM ('ACTIVE', 'DEPRECATED', 'DISABLED', 'EXPERIMENTAL', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "catalog_sources" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "type" "SourceType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL,
    "secretRefs" JSONB NOT NULL DEFAULT '[]',
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "catalog_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capabilities" (
    "id" TEXT NOT NULL,
    "type" "CapabilityType" NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "tags" JSONB NOT NULL DEFAULT '[]',
    "categories" JSONB NOT NULL DEFAULT '[]',
    "maintainers" JSONB NOT NULL DEFAULT '[]',
    "status" "CapabilityStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "sourceId" TEXT NOT NULL,
    "sourceLocator" TEXT NOT NULL,
    "sourceMetadata" JSONB NOT NULL DEFAULT '{}',
    "adminOverrides" JSONB NOT NULL DEFAULT '{}',
    "effectiveData" JSONB NOT NULL DEFAULT '{}',
    "lastSeenSyncId" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capability_versions" (
    "id" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "recommended" BOOLEAN NOT NULL DEFAULT false,
    "commitSha" TEXT,
    "integrity" TEXT,
    "archiveSha256" TEXT,
    "manifestChecksum" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "capability_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_versions" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'RUNNING',
    "fullSync" BOOLEAN NOT NULL DEFAULT true,
    "discovered" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "error" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_items" (
    "id" TEXT NOT NULL,
    "syncRunId" TEXT NOT NULL,
    "capabilityId" TEXT,
    "locator" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "capabilities_type_status_idx" ON "capabilities"("type", "status");

-- CreateIndex
CREATE INDEX "capabilities_sourceId_deletedAt_idx" ON "capabilities"("sourceId", "deletedAt");

-- CreateIndex
CREATE INDEX "capability_versions_capabilityId_recommended_idx" ON "capability_versions"("capabilityId", "recommended");

-- CreateIndex
CREATE UNIQUE INDEX "capability_versions_capabilityId_version_key" ON "capability_versions"("capabilityId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "role_versions_roleId_version_key" ON "role_versions"("roleId", "version");

-- CreateIndex
CREATE INDEX "sync_runs_sourceId_startedAt_idx" ON "sync_runs"("sourceId", "startedAt");

-- CreateIndex
CREATE INDEX "sync_items_syncRunId_status_idx" ON "sync_items"("syncRunId", "status");

-- CreateIndex
CREATE INDEX "admin_audit_logs_resourceType_resourceId_createdAt_idx" ON "admin_audit_logs"("resourceType", "resourceId", "createdAt");

-- AddForeignKey
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "catalog_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capability_versions" ADD CONSTRAINT "capability_versions_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "capabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_versions" ADD CONSTRAINT "role_versions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "catalog_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_items" ADD CONSTRAINT "sync_items_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "sync_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
