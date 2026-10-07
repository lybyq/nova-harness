export interface CapabilityVersion {
  id?: string;
  version: string;
  recommended: boolean;
  commitSha?: string | null;
  integrity?: string | null;
  archiveSha256?: string | null;
  manifestChecksum?: string | null;
  metadata?: Record<string, unknown>;
}

export interface Capability {
  id: string;
  type: string;
  name: string;
  displayName: string;
  description: string;
  tags?: string[];
  categories?: string[];
  status: string;
  riskLevel: string;
  sourceId: string;
  sourceLocator: string;
  updatedAt: string;
  versions: CapabilityVersion[];
}

export interface CatalogPage {
  data: Capability[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CapabilityCompatibility {
  version: string;
  runtimeBindings: Record<string, unknown>;
}

export interface CapabilityDependencies {
  version?: string;
  dependencies: unknown[];
}

export interface SyncRun {
  id: string;
  sourceId: string;
  status: string;
  discovered: number;
  created: number;
  updated: number;
  failed: number;
  startedAt: string;
  finishedAt?: string | null;
}
