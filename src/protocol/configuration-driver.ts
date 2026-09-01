import type { NormalizedAcpConfiguration } from '../configuration/catalog.js';
import type { AgentDefinition } from '../contracts/agent-definition.js';

interface ConfigurationTransport {
  readonly input: WritableStream<Uint8Array>;
  readonly output: ReadableStream<Uint8Array>;
}

export interface ProtocolConfigurationRequest {
  readonly definition: AgentDefinition;
  readonly transport: ConfigurationTransport;
  readonly workspace: string;
  readonly activity: () => void;
}

export interface ProtocolConfigurationSession {
  readonly catalog: NormalizedAcpConfiguration;
  close(): Promise<void>;
}

export interface ProtocolConfigurationDriver {
  inspect(request: ProtocolConfigurationRequest): Promise<ProtocolConfigurationSession>;
}
