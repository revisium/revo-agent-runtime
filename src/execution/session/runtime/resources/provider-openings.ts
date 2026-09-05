interface ProviderResourceTarget<Resource> {
  register(resourceId: string, resource: Resource): boolean;
}

interface ProviderOpening<Resource> {
  readonly resourceId: string;
  readonly resource: Resource;
}

export class ProviderOpeningRegistry<Resource> {
  readonly #openings = new Map<string, ProviderOpening<Resource>>();
  readonly #resourceIds = new Set<string>();

  get size(): number {
    return this.#openings.size;
  }

  get(resourceId: string): Resource | undefined {
    for (const opening of this.#openings.values())
      if (opening.resourceId === resourceId) return opening.resource;
    return undefined;
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

  takeByResourceId(resourceId: string): Resource | undefined {
    for (const [effectId, opening] of this.#openings)
      if (opening.resourceId === resourceId) return this.take(effectId, resourceId);
    return undefined;
  }

  promote(effectId: string, resourceId: string, target: ProviderResourceTarget<Resource>): boolean {
    const resource = this.take(effectId, resourceId);
    if (resource === undefined) return false;
    if (target.register(resourceId, resource)) return true;
    this.register(effectId, resourceId, resource);
    return false;
  }
}
