import type { AgentDescriptor, AgentExecutionPin } from '../../../contracts/manager/core.js';
import type {
  AgentSessionLaunchContext,
  OpenAgentSession,
  ResumeAgentSession,
} from '../../../contracts/session.js';
import type { SessionOpeningCommand } from '../../../execution/session/runtime/actor/port.js';
import { decodeResumeToken, inspectResumeTokenPin } from '../boundary/checkpoint/decode.js';
import { captureSessionLaunchContext } from '../boundary/input/context.js';
import { decodeOpenAgentSession } from '../boundary/input/open.js';
import { decodeResumeAgentSession } from '../boundary/input/resume.js';
import { continuationId, sessionId } from '../policy/identity/identifiers.js';
import {
  resolveAgentSessionLimits,
  type EffectiveAgentSessionLimits,
} from '../policy/limits/resolve.js';
import { SessionAgentCatalog } from './catalog.js';
import type { ManagedAgentSessionsOptions } from './options.js';
import { ManagedSessionRegistry } from './registry.js';

export interface PreparedManagedSessionOpening {
  readonly command: SessionOpeningCommand;
  readonly epoch: number;
  readonly limits: EffectiveAgentSessionLimits;
  readonly pin: AgentExecutionPin;
}

const pinOf = (descriptor: AgentDescriptor): AgentExecutionPin =>
  Object.freeze({
    agentId: descriptor.agent.id,
    agentVersion: descriptor.agent.version,
    definitionDigest: descriptor.definitionDigest,
  });

export class ManagedSessionOpeningBuilder {
  constructor(
    private readonly options: ManagedAgentSessionsOptions,
    private readonly catalog: SessionAgentCatalog,
    private readonly registry: ManagedSessionRegistry,
  ) {}

  fresh(
    input: OpenAgentSession,
    context?: AgentSessionLaunchContext,
  ): PreparedManagedSessionOpening {
    const request = decodeOpenAgentSession(input);
    const launch = captureSessionLaunchContext(
      context,
      this.options.hostEnvironment?.() ?? {},
      this.options.redactionSecrets,
    );
    const id = sessionId(request.sessionId);
    const pin = pinOf(this.catalog.require(request.agent));
    const limits = resolveAgentSessionLimits(request.limits);
    const epoch = this.registry.claimFresh(id);
    const observed = this.options.clock.now();
    return {
      command: {
        call: { callId: this.options.nextIdentity('call'), epoch, sessionId: id },
        observedAt: observed.iso,
        observedAtMs: observed.milliseconds,
        opening: {
          acceptedAt: observed.iso,
          acceptedAtMs: observed.milliseconds,
          incarnationId: this.options.nextIdentity('incarnation'),
          environment: launch.environment,
          limits,
          ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
          pin,
          request: { kind: 'fresh', request },
          streamId: this.options.nextIdentity('stream'),
          usageBaseline: { scope: 'session_cumulative' },
        },
        type: 'session.open',
      },
      epoch,
      limits,
      pin,
    };
  }

  resume(
    input: ResumeAgentSession,
    context?: AgentSessionLaunchContext,
  ): PreparedManagedSessionOpening {
    const request = decodeResumeAgentSession(input);
    const launch = captureSessionLaunchContext(
      context,
      this.options.hostEnvironment?.() ?? {},
      this.options.redactionSecrets,
    );
    const pin = pinOf(this.catalog.requirePin(inspectResumeTokenPin(request.token)));
    const limits = resolveAgentSessionLimits(request.limits);
    const decoded = decodeResumeToken(
      request.token,
      pin,
      this.options.digest,
      limits.maxCheckpointBytes,
    );
    const id = sessionId(decoded.token.sessionId);
    continuationId(decoded.token.resumeTokenId);
    const epoch = this.registry.claimResume(id, decoded.token.resumeTokenId);
    const observed = this.options.clock.now();
    return {
      command: {
        call: { callId: this.options.nextIdentity('call'), epoch, sessionId: id },
        observedAt: observed.iso,
        observedAtMs: observed.milliseconds,
        opening: {
          acceptedAt: observed.iso,
          acceptedAtMs: observed.milliseconds,
          incarnationId: this.options.nextIdentity('incarnation'),
          environment: launch.environment,
          limits,
          ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
          pin,
          request: {
            continuation: decoded.envelope.provider,
            kind: 'resume',
            request: { ...request, token: decoded.token },
          },
          streamId: this.options.nextIdentity('stream'),
          usageBaseline: decoded.envelope.usageBaseline,
          ...(decoded.envelope.acceptedTurnIds === undefined
            ? {}
            : { acceptedTurnIds: decoded.envelope.acceptedTurnIds }),
        },
        type: 'session.resume',
      },
      epoch,
      limits,
      pin,
    };
  }
}
