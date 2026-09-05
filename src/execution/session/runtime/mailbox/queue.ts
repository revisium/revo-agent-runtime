export const MAILBOX_LIMITS = Object.freeze({
  ordinary: 256,
  providerUpdates: 64,
});

type MailboxLane = 'ordinary' | 'provider_update' | 'reserved' | 'control';

export type MailboxAdmissionOptions =
  | { readonly lane: Exclude<MailboxLane, 'control'> }
  | { readonly lane: 'control'; readonly key: string };

export interface MailboxEntry<Value> {
  readonly ticket: number;
  readonly value: Value;
  readonly lane: MailboxLane;
  readonly controlKey?: string;
}

export type MailboxAdmission<Value> =
  | { readonly state: 'accepted'; readonly ticket: number }
  | { readonly state: 'coalesced'; readonly ticket: number; readonly leader: Value }
  | { readonly state: 'rejected'; readonly ticket: undefined };

export class SessionMailboxQueue<Value> {
  readonly #entries: MailboxEntry<Value>[] = [];
  readonly #controlLeaders = new Map<string, MailboxEntry<Value>>();
  #ordinaryCount = 0;
  #providerUpdateCount = 0;
  #nextTicket = 0;

  get size(): number {
    return this.#entries.length;
  }

  admit(value: Value, options: MailboxAdmissionOptions): MailboxAdmission<Value> {
    if (options.lane === 'ordinary' && this.#ordinaryCount >= MAILBOX_LIMITS.ordinary)
      return { state: 'rejected', ticket: undefined };
    if (
      options.lane === 'provider_update' &&
      this.#providerUpdateCount >= MAILBOX_LIMITS.providerUpdates
    )
      return { state: 'rejected', ticket: undefined };
    if (options.lane === 'control') {
      const leader = this.#controlLeaders.get(options.key);
      if (leader !== undefined)
        return { leader: leader.value, state: 'coalesced', ticket: leader.ticket };
    }

    const entry: MailboxEntry<Value> = {
      ...(options.lane === 'control' ? { controlKey: options.key } : {}),
      lane: options.lane,
      ticket: this.#nextTicket,
      value,
    };
    this.#nextTicket += 1;
    this.#entries.push(entry);
    if (options.lane === 'ordinary') this.#ordinaryCount += 1;
    if (options.lane === 'provider_update') this.#providerUpdateCount += 1;
    if (options.lane === 'control') this.#controlLeaders.set(options.key, entry);
    return { state: 'accepted', ticket: entry.ticket };
  }

  take(): MailboxEntry<Value> | undefined {
    const entry = this.#entries.shift();
    if (entry === undefined) return undefined;
    if (entry.lane === 'ordinary') this.#ordinaryCount -= 1;
    if (entry.lane === 'provider_update') this.#providerUpdateCount -= 1;
    if (entry.controlKey !== undefined) this.#controlLeaders.delete(entry.controlKey);
    return entry;
  }
}
