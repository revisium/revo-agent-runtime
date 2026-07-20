import type { JsonObject, JsonSchema202012 } from '../json/index.js';
import type { AgentArgumentTemplate } from './agent-argument-template.js';
import type { AgentVersionProbe } from './agent-version-probe.js';

export interface AgentDefinitionContract {
  readonly schemaVersion: 'agent-definition/v1';
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly description?: string;
  readonly launch: {
    readonly command: string;
    readonly args: readonly AgentArgumentTemplate[];
    readonly versionProbe?: AgentVersionProbe;
  };
  readonly protocol: {
    readonly driver: 'native/stdio-v1' | 'acp/v1';
    readonly resultParser?: 'codex-jsonl/v1' | 'claude-stream-json/v1';
    readonly permissionStrategy: 'codex-cli/v1' | 'claude-cli/v1' | 'acp/v1';
  };
  readonly delivery: {
    readonly prompt: 'argument' | 'stdin' | 'file' | 'protocol';
    readonly resultSchema: 'argument' | 'file' | 'protocol';
    readonly result: 'stdout' | 'protocol';
  };
  readonly parameters: { readonly schema: JsonSchema202012; readonly defaults?: JsonObject };
  readonly permissions: { readonly schema: JsonSchema202012; readonly defaults?: JsonObject };
  readonly capabilities: {
    readonly cancellation: boolean;
    readonly structuredResult: true;
    readonly usage: boolean;
  };
  readonly constraints?: {
    readonly platforms?: readonly ('darwin' | 'linux' | 'win32')[];
    readonly executableVersion?: string;
  };
}
