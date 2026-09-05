import type { AgentSession } from '../../../contracts/session/api/session.js';
import type {
  AgentSessionFilter,
  AgentSessionSnapshot,
  AgentSessionTerminalFilter,
  AgentSessionTerminalRecord,
} from '../../../contracts/session/lifecycle/snapshot.js';
import type { SessionCommandRuntime } from '../../../execution/session/runtime/actor/port.js';
import type { EffectiveAgentSessionManagerLimits } from '../policy/limits/resolve.js';
import {
  resolveAgentSessionLimits,
  type EffectiveAgentSessionLimits,
} from '../policy/limits/resolve.js';
import { sessionManagerError } from './errors.js';

export interface ManagedSessionEntry {
  readonly limits: EffectiveAgentSessionLimits;
  readonly sessionId: string;
  readonly epoch: number;
  readonly runtime: SessionCommandRuntime;
  handle?: AgentSession;
}

const matchesAgent = (
  pin: AgentSessionSnapshot['pin'],
  agent: AgentSessionFilter['agent'],
): boolean =>
  agent === undefined || (pin.agentId === agent.id && pin.agentVersion === agent.version);

export class ManagedSessionRegistry {
  readonly #active = new Map<string, ManagedSessionEntry>();
  readonly #epochs = new Map<string, number>();
  readonly #terminal = new Map<string, AgentSessionTerminalRecord>();
  readonly #usedResumeTokens = new Set<string>();

  constructor(private readonly limits: EffectiveAgentSessionManagerLimits) {}

  claimFresh(sessionId: string): number {
    this.reconcileAll();
    if (this.#epochs.has(sessionId))
      throw sessionManagerError('revo.agent.session_duplicate', 'The session identity is in use.');
    return this.#claim(sessionId);
  }

  claimResume(sessionId: string, resumeTokenId: string): number {
    this.reconcileAll();
    if (this.#active.has(sessionId))
      throw sessionManagerError('revo.agent.session_duplicate', 'The session is still active.');
    if (this.#usedResumeTokens.has(resumeTokenId))
      throw sessionManagerError(
        'revo.agent.resume_token_consumed',
        'The session resume token was already consumed.',
      );
    const terminal = this.#terminal.get(sessionId);
    if (
      terminal !== undefined &&
      (terminal.status !== 'hibernated' || terminal.resumeToken.resumeTokenId !== resumeTokenId)
    )
      throw sessionManagerError('revo.agent.session_duplicate', 'The session cannot be resumed.');
    const epoch = this.#claim(sessionId);
    this.#usedResumeTokens.add(resumeTokenId);
    return epoch;
  }

  register(
    sessionId: string,
    epoch: number,
    runtime: SessionCommandRuntime,
    limits: EffectiveAgentSessionLimits = resolveAgentSessionLimits(undefined),
  ): void {
    this.#active.set(sessionId, { epoch, runtime, sessionId, limits });
    this.#epochs.set(sessionId, epoch);
    this.#terminal.delete(sessionId);
  }

  attach(sessionId: string, handle: AgentSession): void {
    const entry = this.#active.get(sessionId);
    if (entry !== undefined) entry.handle = handle;
  }

  get(sessionId: string): AgentSession | undefined {
    return this.entry(sessionId)?.handle;
  }

  entry(sessionId: string): ManagedSessionEntry | undefined {
    this.reconcile(sessionId);
    return this.#active.get(sessionId);
  }

  runtime(sessionId: string): SessionCommandRuntime | undefined {
    this.reconcile(sessionId);
    return this.#active.get(sessionId)?.runtime;
  }

  inspect(sessionId: string): AgentSessionSnapshot | undefined {
    this.reconcile(sessionId);
    return this.#active.get(sessionId)?.runtime.inspect();
  }

  list(filter: AgentSessionFilter = {}): readonly AgentSessionSnapshot[] {
    this.reconcileAll();
    return Object.freeze(
      [...this.#active.values()]
        .map(({ runtime }) => runtime.inspect())
        .filter((value): value is AgentSessionSnapshot => value !== undefined)
        .filter(
          (value) =>
            (filter.sessionId === undefined || value.sessionId === filter.sessionId) &&
            matchesAgent(value.pin, filter.agent) &&
            (filter.statuses === undefined || filter.statuses.includes(value.status)),
        ),
    );
  }

  terminal(sessionId: string): AgentSessionTerminalRecord | undefined {
    this.reconcile(sessionId);
    return this.#terminal.get(sessionId);
  }

  listTerminal(filter: AgentSessionTerminalFilter = {}): readonly AgentSessionTerminalRecord[] {
    this.reconcileAll();
    return Object.freeze(
      [...this.#terminal.values()].filter(
        (value) =>
          (filter.sessionId === undefined || value.sessionId === filter.sessionId) &&
          matchesAgent(value.pin, filter.agent) &&
          (filter.statuses === undefined || filter.statuses.includes(value.status)),
      ),
    );
  }

  reconcile(sessionId: string): void {
    const entry = this.#active.get(sessionId);
    const terminal = entry?.runtime.terminal();
    if (entry === undefined || terminal === undefined) return;
    this.#active.delete(sessionId);
    this.#terminal.delete(sessionId);
    this.#terminal.set(sessionId, terminal);
    while (this.#terminal.size > this.limits.maxCompletedSessions) {
      const oldest = this.#terminal.keys().next().value!;
      this.#terminal.delete(oldest);
    }
  }

  reconcileAll(): void {
    for (const sessionId of this.#active.keys()) this.reconcile(sessionId);
  }

  activeEntries(): readonly ManagedSessionEntry[] {
    this.reconcileAll();
    return Object.freeze([...this.#active.values()]);
  }

  #claim(sessionId: string): number {
    if (!this.#epochs.has(sessionId) && this.#epochs.size >= this.limits.maxSessionIdentities)
      throw sessionManagerError(
        'revo.agent.session_identity_capacity',
        'The session identity capacity is exhausted.',
      );
    if (this.#active.size >= this.limits.maxActiveSessions)
      throw sessionManagerError(
        'revo.agent.session_capacity',
        'The active session capacity is exhausted.',
      );
    const opening = [...this.#active.values()].filter(
      ({ runtime }) => runtime.inspect()?.status === 'opening',
    ).length;
    if (opening >= this.limits.maxOpeningSessions)
      throw sessionManagerError(
        'revo.agent.session_capacity',
        'The opening session capacity is exhausted.',
      );
    return (this.#epochs.get(sessionId) ?? 0) + 1;
  }
}
