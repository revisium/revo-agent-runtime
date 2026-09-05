import type {
  CancelAgentSessionResult,
  RespondAgentSessionRequest,
  RespondAgentSessionResult,
} from '../../../contracts/session.js';
import { decodeRespondAgentSessionRequest } from '../boundary/input/response.js';
import { dispatchCall } from '../handles/call.js';
import { interactionRequestId } from '../policy/identity/identifiers.js';
import { sessionManagerError } from './errors.js';
import type { ManagedAgentSessionsOptions } from './options.js';
import type { ManagedSessionEntry, ManagedSessionRegistry } from './registry.js';

export class ManagedSessionControls {
  constructor(
    private readonly options: Pick<ManagedAgentSessionsOptions, 'clock' | 'nextIdentity'>,
    private readonly registry: ManagedSessionRegistry,
  ) {}

  async cancel(id: string, reason?: string): Promise<CancelAgentSessionResult> {
    const entry = this.registry.entry(id);
    if (entry !== undefined) return this.cancelEntry(entry, reason);
    if (this.registry.terminal(id) !== undefined) return { state: 'already_terminal' };
    throw sessionManagerError(
      'revo.agent.session_unknown',
      'The session is unknown.',
      'session_running',
    );
  }

  async cancelEntry(
    entry: ManagedSessionEntry,
    reason?: string,
  ): Promise<CancelAgentSessionResult> {
    if (entry.handle !== undefined) return entry.handle.cancel(reason);
    const resolution = await dispatchCall(
      entry.runtime,
      {
        ...this.observed(entry),
        ...(reason === undefined ? {} : { reason }),
        type: 'session.cancel',
      },
      'cancel_session',
    );
    return resolution.result;
  }

  async respond(id: string, input: RespondAgentSessionRequest): Promise<RespondAgentSessionResult> {
    const entry = this.registry.entry(id);
    if (entry === undefined)
      throw sessionManagerError(
        'revo.agent.session_unknown',
        'The session is unknown.',
        'session_running',
      );
    if (entry.handle !== undefined) return entry.handle.respond(input);
    const decoded = decodeRespondAgentSessionRequest(input, entry.limits);
    interactionRequestId(decoded.requestId);
    const resolution = await dispatchCall(
      entry.runtime,
      {
        ...this.observed(entry),
        input: decoded,
        type: 'interaction.respond',
      },
      'interaction',
    );
    return resolution.result;
  }

  private observed(entry: ManagedSessionEntry) {
    const observed = this.options.clock.now();
    return {
      call: {
        callId: this.options.nextIdentity('call'),
        epoch: entry.epoch,
        sessionId: entry.sessionId,
      },
      observedAt: observed.iso,
      observedAtMs: observed.milliseconds,
    };
  }
}
