export type DirectoryKind = 'temp' | 'worktree' | 'path';

export interface DirectorySpecBase {
  alias: string;
  kind: DirectoryKind;
  description?: string;
  keep?: boolean;
}

export interface TempDirectorySpec extends DirectorySpecBase {
  kind: 'temp';
  base?: string;
}

export interface WorktreeDirectorySpec extends DirectorySpecBase {
  kind: 'worktree';
  source?: string;
  ref?: string;
}

export interface PathDirectorySpec extends DirectorySpecBase {
  kind: 'path';
  path: string;
}

export type DirectorySpec = TempDirectorySpec | WorktreeDirectorySpec | PathDirectorySpec;

export type AccessMode = 'read-only' | 'read-write';

export interface AgentType {
  alias: string;
  prePrompt?: string;
  access?: AccessMode;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  defaultRoot?: string;
  defaultDirectories?: string[];
}

export interface AgentInstance {
  alias: string;
  type: string;
  input?: 'stdin' | string;
  root?: string;
  directories?: string[];
  params?: Record<string, unknown>;
  env?: Record<string, string>;
}

export interface StageDirectoryRef {
  from: string;
}

export interface StageSpec {
  alias: string;
  directories?: Record<string, DirectorySpec | StageDirectoryRef>;
  agents: AgentInstance[];
}

export interface PipelineFile {
  version?: string;
  name?: string;
  description?: string;
  directories?: Record<string, DirectorySpec>;
  agent_types?: Record<string, AgentType>;
  stages: StageSpec[];
}

export type ResolvedDirectory = DirectorySpec & {
  path: string;
  stageAlias: string;
};

export type ResolvedAgentType = AgentType;

export interface ResolvedAgentInstance extends AgentInstance {
  stageAlias: string;
  root?: string;
  directories?: string[];
}

export interface PreparedDirectory {
  alias: string;
  path: string;
  keep?: boolean;
  kind: DirectoryKind;
  stageAlias: string;
  cleanup?: () => Promise<void>;
}

export interface AgentExecutionContext {
  pipelineInput: string;
  directoryMap: Record<string, PreparedDirectory>;
  agentTypes: Record<string, ResolvedAgentType>;
}

export interface ExecutionOptions {
  dryRun?: boolean;
  cwd: string;
  codexBin?: string;
  verbose?: boolean;
}
