// Core types for claw package manager

export interface PackageMeta {
  name: string;
  version: string;
  description?: string;
  type?: 'skill' | 'agent';
  dependencies?: Record<string, string>;
}

export interface InstalledPackage {
  name: string;
  version: string;
  scope: 'skill' | 'agent';
  description?: string;
}

export interface LockfileEntry {
  name: string;
  version: string;
  source: 'registry' | 'pack';
  scope: 'skill' | 'agent';
}

export interface Lockfile {
  version: number;
  scene: string | null;
  agents: LockfileEntry[];
  skills: LockfileEntry[];
}

export interface SearchResult {
  name: string;
  version: string;
  scope: 'skill' | 'agent';
  description?: string;
}

export interface ResolvedPackage {
  name: string;
  version: string;
  scope: 'skill' | 'agent';
}

export interface VerifyResult {
  name: string;
  scope: 'skill' | 'agent';
  ok: boolean;
  actual: string;
}