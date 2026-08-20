import type { ExecutionBinding } from '../execution-binding.js';
import type { OutputResourcePlan } from '../output-resource-plan.js';
import type { PreparedInvocationPayloads } from '../payload-preparation/index.js';

export interface PreparedInvocationMaterial {
  readonly pin: Readonly<{ agentId: string; agentVersion: string; definitionDigest: string }>;
  readonly workspaceDirectory: string;
  readonly reportedVersion: string;
  readonly binding: ExecutionBinding;
  readonly outputResourcePlan: OutputResourcePlan;
  readonly preparedPayloads: PreparedInvocationPayloads;
}
