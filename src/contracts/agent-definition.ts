type JsonPrimitive = boolean | number | string | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

interface JsonArray extends ReadonlyArray<JsonValue> {}

export type AgentArgumentTemplate =
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'workspace' }
  | { readonly kind: 'prompt' }
  | { readonly kind: 'prompt-file' }
  | { readonly kind: 'result-schema' }
  | { readonly kind: 'result-schema-file' }
  | { readonly kind: 'parameter'; readonly name: string; readonly omitIfMissing?: boolean }
  | { readonly kind: 'permission'; readonly name: string; readonly omitIfMissing?: boolean };

interface AgentVersionProbe {
  readonly args: readonly string[];
  readonly stream: 'stdout' | 'stderr';
  readonly prefix?: string;
  readonly timeoutMs: number;
}

export interface AgentDefinition {
  readonly schemaVersion: 'agent-definition/v1';
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly description?: string;
  readonly launch: {
    readonly command: string;
    readonly args: readonly AgentArgumentTemplate[];
    readonly versionProbe: AgentVersionProbe;
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
  readonly parameters: { readonly schema: JsonObject; readonly defaults?: JsonObject };
  readonly permissions: { readonly schema: JsonObject; readonly defaults?: JsonObject };
  readonly capabilities: {
    readonly cancellation: boolean;
    readonly structuredResult: true;
    readonly usage: boolean;
  };
  readonly constraints?: {
    readonly platforms?: readonly ('darwin' | 'linux' | 'win32')[];
  };
}

interface AgentProtocolInput {
  readonly driver: string;
  readonly resultParser?: string;
  readonly permissionStrategy: string;
}

export type AgentDefinitionInput = Omit<AgentDefinition, 'protocol'> & {
  readonly protocol: AgentProtocolInput;
};

export interface AgentRef {
  readonly id: string;
  readonly version: string;
}
