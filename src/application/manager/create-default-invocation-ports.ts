import { NodeMonotonicInvocationClock } from '../../platform/clock/index.js';
import {
  createNodePosixInvocationOutputPort,
  NodePosixExecutableProbePort,
  NodePosixOutputClaimPort,
  NodePosixOutputPreparationPort,
  NodePosixProcessSpawnDispatch,
  NodePosixWorkspacePort,
} from '../../platform/process/index.js';
import type { AgentManagerLimits } from '../../runtime/spec/index.js';
import { createNamedHostEnvironmentSnapshot } from './create-named-host-environment-snapshot.js';
import { createNativeProcessExecutionPort } from './create-native-process-execution-port.js';
import type { createInvocationLifecycleManager } from './lifecycle-manager.js';

type LifecycleManagerPorts = Parameters<typeof createInvocationLifecycleManager>[1];
type DefaultInvocationPorts = LifecycleManagerPorts &
  Required<Pick<LifecycleManagerPorts, 'execution' | 'executableProbe'>>;

// Probe-time executable resolution and version gating use this fixed host-inherited environment.
// A consumer's per-invocation AgentStartContext.environment applies only to the invocation that
// follows, never to this resolution step, so a toolchain reachable only through a consumer-supplied
// PATH (nvm, asdf) can probe as not_found even though its invocation would have launched.
// AgentManager v1 does not specify a probe environment; making it consumer-configurable is a
// deliberately separate decision and is not promised by this surface.
const PROBE_INHERITED_ENVIRONMENT_NAMES = Object.freeze(['PATH', 'HOME', 'TMPDIR', 'LANG']);

export const createDefaultInvocationPorts = (
  limits: Readonly<AgentManagerLimits>,
): DefaultInvocationPorts =>
  Object.freeze({
    execution: createNativeProcessExecutionPort(
      new NodePosixProcessSpawnDispatch(),
      limits.activeStateOperationTimeoutMs,
    ),
    executableProbe: new NodePosixExecutableProbePort(
      createNamedHostEnvironmentSnapshot(PROBE_INHERITED_ENVIRONMENT_NAMES),
    ),
    clock: new NodeMonotonicInvocationClock(),
    workspace: new NodePosixWorkspacePort(),
    outputClaim: new NodePosixOutputClaimPort(),
    outputPreparation: new NodePosixOutputPreparationPort(),
    output: createNodePosixInvocationOutputPort({
      ...(limits.maxEventBytes === undefined ? {} : { maxEventBytes: limits.maxEventBytes }),
      ...(limits.maxEventsFileBytes === undefined
        ? {}
        : { maxEventsFileBytes: limits.maxEventsFileBytes }),
    }),
  });
