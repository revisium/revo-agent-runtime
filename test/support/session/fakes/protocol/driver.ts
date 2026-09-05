import type {
  SessionProtocolCancellationOutcome,
  SessionProtocolCheckpointOutcome,
  SessionProtocolCloseOutcome,
  SessionProtocolInteractionOutcome,
} from '../../../../../src/protocol/session/model/outcome.js';
import type { SessionProtocolInteractionResponseRequest } from '../../../../../src/protocol/session/model/request.js';
import type {
  FreshSessionProtocolOpeningRequest,
  ResumeSessionProtocolOpeningRequest,
  SessionProtocolDriver,
} from '../../../../../src/protocol/session/port/driver.js';
import type {
  SessionProtocolOpening,
  SessionProtocolOpeningResult,
} from '../../../../../src/protocol/session/port/opening.js';
import type {
  ObservedSessionProtocolPromptRequest,
  SessionProtocolObserver,
  SessionProtocolPrompt,
  SessionProtocolSession,
} from '../../../../../src/protocol/session/port/session.js';
import { FakeSessionProtocolBarriers } from './barriers.js';
import type {
  FakeSessionProtocolOpeningScript,
  FakeSessionProtocolPromptScript,
  FakeSessionProtocolScript,
  FakeSessionProtocolStep,
} from './script.js';

export type FakeSessionProtocolCall =
  | { readonly type: 'open.fresh'; readonly request: FreshSessionProtocolOpeningRequest }
  | { readonly type: 'open.resume'; readonly request: ResumeSessionProtocolOpeningRequest }
  | { readonly type: 'prompt'; readonly request: ObservedSessionProtocolPromptRequest }
  | {
      readonly type: 'interaction.respond';
      readonly request: SessionProtocolInteractionResponseRequest;
    }
  | { readonly type: 'prompt.cancel'; readonly reason?: string }
  | { readonly type: 'checkpoint' }
  | { readonly type: 'session.close'; readonly reason?: string };

export class ControllableSessionProtocolDriver implements SessionProtocolDriver {
  readonly barriers = new FakeSessionProtocolBarriers();
  readonly #calls: FakeSessionProtocolCall[] = [];
  readonly #openings: FakeSessionProtocolOpeningScript[];
  readonly #prompts: FakeSessionProtocolPromptScript[];
  readonly #interactions: SessionProtocolInteractionOutcome[];
  readonly #checkpoints: SessionProtocolCheckpointOutcome[];
  readonly #cancellations: SessionProtocolCancellationOutcome[];
  readonly #closes: SessionProtocolCloseOutcome[];

  constructor(script: FakeSessionProtocolScript) {
    this.#openings = [...script.openings];
    this.#prompts = [...(script.prompts ?? [])];
    this.#interactions = [...(script.interactions ?? [])];
    this.#checkpoints = [...(script.checkpoints ?? [])];
    this.#cancellations = [...(script.cancellations ?? [])];
    this.#closes = [...(script.closes ?? [])];
  }

  get calls(): readonly FakeSessionProtocolCall[] {
    return this.#calls;
  }

  openFresh(request: FreshSessionProtocolOpeningRequest): SessionProtocolOpening {
    this.#calls.push({ request, type: 'open.fresh' });
    return this.#open(request.observer, this.#opening('fresh'));
  }

  resume(request: ResumeSessionProtocolOpeningRequest): SessionProtocolOpening {
    this.#calls.push({ request, type: 'open.resume' });
    return this.#open(request.observer, this.#opening('resume'));
  }

  #open(observer: SessionProtocolObserver, script: FakeSessionProtocolOpeningScript) {
    const session = new FakeSessionProtocolSession(this);
    const completion = this.#completeOpening(observer, script, session);
    return Object.freeze({
      completion,
      close: (reason?: string) => this.close(reason),
      respond: (request: SessionProtocolInteractionResponseRequest) => this.respond(request),
    });
  }

  async #completeOpening(
    observer: SessionProtocolObserver,
    script: FakeSessionProtocolOpeningScript,
    session: SessionProtocolSession,
  ): Promise<SessionProtocolOpeningResult> {
    await this.#steps(observer, script.steps);
    if (script.outcome.status !== 'opened') return script.outcome;
    return { ...script.outcome, session };
  }

  prompt(request: ObservedSessionProtocolPromptRequest): SessionProtocolPrompt {
    this.#calls.push({ request, type: 'prompt' });
    const script = this.#required(this.#prompts, 'prompt');
    return Object.freeze({
      cancel: (reason?: string) => this.cancelPrompt(reason),
      completion: this.#completePrompt(request.observer, script),
    });
  }

  async #completePrompt(
    observer: SessionProtocolObserver,
    script: FakeSessionProtocolPromptScript,
  ) {
    await this.#steps(observer, script.steps);
    return script.outcome;
  }

  async respond(
    request: SessionProtocolInteractionResponseRequest,
  ): Promise<SessionProtocolInteractionOutcome> {
    this.#calls.push({ request, type: 'interaction.respond' });
    return this.#required(this.#interactions, 'interaction response');
  }

  async checkpoint(): Promise<SessionProtocolCheckpointOutcome> {
    this.#calls.push({ type: 'checkpoint' });
    return this.#required(this.#checkpoints, 'checkpoint');
  }

  async cancelPrompt(reason?: string): Promise<SessionProtocolCancellationOutcome> {
    this.#calls.push({ ...(reason === undefined ? {} : { reason }), type: 'prompt.cancel' });
    return this.#required(this.#cancellations, 'prompt cancellation');
  }

  async close(reason?: string): Promise<SessionProtocolCloseOutcome> {
    this.#calls.push({ ...(reason === undefined ? {} : { reason }), type: 'session.close' });
    return this.#required(this.#closes, 'session close');
  }

  #steps(
    observer: SessionProtocolObserver,
    steps: readonly FakeSessionProtocolStep[],
  ): Promise<void> {
    return steps.reduce(
      (preceding, step) => preceding.then(() => this.#step(observer, step)),
      Promise.resolve(),
    );
  }

  #step(observer: SessionProtocolObserver, step: FakeSessionProtocolStep): Promise<void> {
    return step.type === 'wait' ? this.barriers.wait(step.barrier) : observer.update(step.value);
  }

  #opening(kind: 'fresh' | 'resume'): FakeSessionProtocolOpeningScript {
    const script = this.#required(this.#openings, `${kind} opening`);
    if (script.kind !== kind) throw new Error(`Expected ${script.kind} opening, received ${kind}.`);
    return script;
  }

  #required<Value>(queue: Value[], operation: string): Value {
    const value = queue.shift();
    if (value === undefined) throw new Error(`Missing fake protocol script for ${operation}.`);
    return value;
  }
}

class FakeSessionProtocolSession implements SessionProtocolSession {
  constructor(private readonly driver: ControllableSessionProtocolDriver) {}

  prompt(request: ObservedSessionProtocolPromptRequest): SessionProtocolPrompt {
    return this.driver.prompt(request);
  }

  respond(request: SessionProtocolInteractionResponseRequest) {
    return this.driver.respond(request);
  }

  checkpoint() {
    return this.driver.checkpoint();
  }

  close(reason?: string) {
    return this.driver.close(reason);
  }
}

export const createControllableSessionProtocolDriver = (
  script: FakeSessionProtocolScript,
): ControllableSessionProtocolDriver => new ControllableSessionProtocolDriver(script);
