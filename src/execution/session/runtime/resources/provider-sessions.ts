export class ProviderSessionRegistry<Resource> {
  readonly #resources = new Map<string, Resource>();

  get size(): number {
    return this.#resources.size;
  }

  register(resourceId: string, resource: Resource): boolean {
    if (this.#resources.has(resourceId)) return false;
    this.#resources.set(resourceId, resource);
    return true;
  }

  get(resourceId: string): Resource | undefined {
    return this.#resources.get(resourceId);
  }

  take(resourceId: string): Resource | undefined {
    const resource = this.#resources.get(resourceId);
    if (resource === undefined) return undefined;
    this.#resources.delete(resourceId);
    return resource;
  }
}
