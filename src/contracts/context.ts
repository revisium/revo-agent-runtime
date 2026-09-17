export type AgentMcpBinding = { readonly value: string } | { readonly environment: string };

export type AgentMcpServer =
  | {
      readonly name: string;
      readonly transport: 'stdio';
      readonly command: string;
      readonly args: readonly string[];
      readonly env?: Readonly<Record<string, AgentMcpBinding>>;
    }
  | {
      readonly name: string;
      readonly transport: 'http';
      readonly url: string;
      readonly headers?: Readonly<Record<string, AgentMcpBinding>>;
    };

export type AgentInstructionsDeliveryChannel =
  | 'acp:session/new._meta.systemPrompt.append'
  | 'opencode:config.instructions-file'
  | 'acp:session/prompt.prefix';

export interface AgentInstructionsDelivery {
  readonly mode: 'native_append' | 'prompt_prefix';
  readonly channel: AgentInstructionsDeliveryChannel;
}
