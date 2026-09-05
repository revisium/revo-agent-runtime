import type { PublicCallResolution, PublicCallSettlement } from '../actor/port.js';

export type { PublicCallSettlement } from '../actor/port.js';

type AgentFault = Extract<PublicCallSettlement, { readonly state: 'rejected' }>['fault'];

interface PendingCall {
  readonly promise: Promise<PublicCallSettlement>;
  readonly settle: (value: PublicCallSettlement) => void;
  readonly followers: Set<string>;
}

const pendingCall = (): PendingCall => {
  let settle: (value: PublicCallSettlement) => void = () => undefined;
  const promise = new Promise<PublicCallSettlement>((resolve) => {
    settle = resolve;
  });
  return { followers: new Set(), promise, settle };
};

export class PublicCallRegistry {
  readonly #calls = new Map<string, PendingCall>();
  readonly #emptyWaiters = new Set<() => void>();

  get size(): number {
    return this.#calls.size;
  }

  register(callId: string): Promise<PublicCallSettlement> {
    const existing = this.#calls.get(callId);
    if (existing !== undefined) return existing.promise;
    const call = pendingCall();
    this.#calls.set(callId, call);
    return call.promise;
  }

  alias(followerId: string, leaderId: string): boolean {
    if (followerId === leaderId) return true;
    const follower = this.#calls.get(followerId);
    const leader = this.#calls.get(leaderId);
    if (follower === undefined || leader === undefined) return false;
    leader.followers.add(followerId);
    return true;
  }

  resolve(callId: string, resolution: PublicCallResolution): boolean {
    return this.#settle(callId, { resolution, state: 'resolved' });
  }

  reject(callId: string, fault: AgentFault): boolean {
    return this.#settle(callId, { fault, state: 'rejected' });
  }

  whenEmpty(): Promise<void> {
    if (this.#calls.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.#emptyWaiters.add(resolve));
  }

  #settle(callId: string, settlement: PublicCallSettlement): boolean {
    if (!this.#calls.has(callId)) return false;
    const remaining = [callId];
    while (remaining.length > 0) {
      const nextId = remaining.shift();
      if (nextId === undefined) break;
      const call = this.#calls.get(nextId);
      if (call === undefined) continue;
      this.#calls.delete(nextId);
      remaining.push(...call.followers);
      call.settle(settlement);
    }
    if (this.#calls.size === 0) {
      for (const resolve of this.#emptyWaiters) resolve();
      this.#emptyWaiters.clear();
    }
    return true;
  }
}
