import type { SessionState } from '../../kernel/model/session-state.js';

interface ProviderResourceTarget<Resource> {
  register(resourceId: string, resource: Resource): boolean;
}

interface ProviderOpening<Resource> {
  readonly resourceId: string;
  readonly resource: Resource;
}

export const ownsProviderResource = (state: SessionState, resourceId: string): boolean => {
  if ('providerResourceId' in state && state.providerResourceId === resourceId) return true;
  return (
    state.status === 'opening' &&
    'providerResourceId' in state.progress &&
    state.progress.providerResourceId === resourceId
  );
};

export class ProviderOpeningRegistry<Resource> {
  readonly #openings = new Map<string, ProviderOpening<Resource>>();
  readonly #resourceIds = new Set<string>();

  get size(): number {
    return this.#openings.size;
  }

  register(effectId: string, resourceId: string, resource: Resource): boolean {
    if (this.#openings.has(effectId) || this.#resourceIds.has(resourceId)) return false;
    this.#openings.set(effectId, { resource, resourceId });
    this.#resourceIds.add(resourceId);
    return true;
  }

  take(effectId: string, resourceId: string): Resource | undefined {
    const opening = this.#openings.get(effectId);
    if (opening?.resourceId !== resourceId) return undefined;
    this.#openings.delete(effectId);
    this.#resourceIds.delete(resourceId);
    return opening.resource;
  }

  promote(effectId: string, resourceId: string, target: ProviderResourceTarget<Resource>): boolean {
    const resource = this.take(effectId, resourceId);
    if (resource === undefined) return false;
    if (target.register(resourceId, resource)) return true;
    this.register(effectId, resourceId, resource);
    return false;
  }
}
