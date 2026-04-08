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
  source?: 'local' | 'remote';
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

export interface SceneConfig {
  name: string;
  description?: string;
  agents?: string[];
  skills?: string[];
  env?: Record<string, string>;
}