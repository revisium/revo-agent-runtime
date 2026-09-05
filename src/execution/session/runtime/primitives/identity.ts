type SessionRuntimeIdentityKind = 'preparation' | 'process' | 'provider';

export interface SessionRuntimeIdentitySource {
  next(kind: SessionRuntimeIdentityKind): string;
}
