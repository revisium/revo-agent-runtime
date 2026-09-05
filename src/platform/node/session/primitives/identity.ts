import { randomUUID } from 'node:crypto';

export interface NodeSessionIdentitySource {
  next(kind: string): string;
}

export const nodeSessionIdentitySource: NodeSessionIdentitySource = Object.freeze({
  next: (kind: string): string => `${kind}_${randomUUID()}`,
});
