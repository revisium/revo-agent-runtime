import {
  createAgentManager,
  type AgentManager,
  type AgentManagerOptions,
} from '../../src/index.js';

type Equal<Left, Right> = [Left] extends [Right] ? ([Right] extends [Left] ? true : false) : false;
type Expect<Value extends true> = Value;

export type CreateAgentManagerReturnIsPublic = Expect<
  Equal<ReturnType<typeof createAgentManager>, AgentManager>
>;
export type CreateAgentManagerParametersAreOptions = Expect<
  Equal<Parameters<typeof createAgentManager>, [AgentManagerOptions]>
>;
export type PublicManagerDoesNotLeakProbeAgents = Expect<
  Equal<'probeAgents' extends keyof AgentManager ? true : false, false>
>;
