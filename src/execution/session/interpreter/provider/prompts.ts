import type { SessionProtocolPrompt } from '../../../../protocol/session/port/session.js';

interface ProviderPromptResource {
  readonly effectId: string;
  readonly prompt: SessionProtocolPrompt;
  readonly cancellationRequested: boolean;
  readonly stopped: Promise<void>;
  readonly stop: () => void;
}

export class ProviderPromptRegistry {
  readonly #prompts = new Map<string, ProviderPromptResource>();

  register(
    providerResourceId: string,
    turnId: string,
    resource: Pick<ProviderPromptResource, 'effectId' | 'prompt'>,
  ): boolean {
    const key = this.#key(providerResourceId, turnId);
    if (this.#prompts.has(key)) return false;
    const stopped = Promise.withResolvers<void>();
    this.#prompts.set(key, {
      ...resource,
      cancellationRequested: false,
      stopped: stopped.promise,
      stop: stopped.resolve,
    });
    return true;
  }

  get(providerResourceId: string, turnId: string): ProviderPromptResource | undefined {
    return this.#prompts.get(this.#key(providerResourceId, turnId));
  }

  markCancelling(providerResourceId: string, turnId: string): ProviderPromptResource | undefined {
    const key = this.#key(providerResourceId, turnId);
    const resource = this.#prompts.get(key);
    if (resource === undefined) return undefined;
    const cancelling = { ...resource, cancellationRequested: true };
    this.#prompts.set(key, cancelling);
    return cancelling;
  }

  take(
    providerResourceId: string,
    turnId: string,
    effectId: string,
  ): ProviderPromptResource | undefined {
    const key = this.#key(providerResourceId, turnId);
    const resource = this.#prompts.get(key);
    if (resource?.effectId !== effectId) return undefined;
    this.#prompts.delete(key);
    return resource;
  }

  takeProvider(providerResourceId: string): readonly ProviderPromptResource[] {
    const prefix = `${providerResourceId}\0`;
    const resources: ProviderPromptResource[] = [];
    for (const [key, resource] of this.#prompts) {
      if (!key.startsWith(prefix)) continue;
      this.#prompts.delete(key);
      resource.stop();
      resources.push(resource);
    }
    return resources;
  }

  #key(providerResourceId: string, turnId: string): string {
    return `${providerResourceId}\0${turnId}`;
  }
}
