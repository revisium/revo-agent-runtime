import type { SessionEventEffect } from './event.js';
import type { SessionLifecycleEffect } from './lifecycle.js';
import type { SessionPersistenceEffect } from './persistence.js';
import type { SessionProviderEffect } from './provider.js';
import type { SessionPublicCallEffect } from './public-call.js';

export type SessionEffect =
  | SessionEventEffect
  | SessionProviderEffect
  | SessionPersistenceEffect
  | SessionLifecycleEffect
  | SessionPublicCallEffect;
