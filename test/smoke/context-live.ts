import { dirname } from 'node:path';

import {
  canonicalExecutableOnPath,
  pinNodeRuntimeWithoutVendorShadow,
} from './support/cli-identity.js';
import { installLiveSpawnPreflight } from './support/live-spawn-preflight.js';

const provider = process.env.REVO_LIVE_CONTEXT_SMOKE;
if (provider !== 'codex' && provider !== 'claude' && provider !== 'grok' && provider !== 'opencode')
  throw new Error('Live launcher requires exactly one context provider');
if (process.env.REVO_LIVE_AUTH_SOURCE !== 'cached-login')
  throw new Error('Live launcher requires existing cached-login');
if (!process.env.REVO_LIVE_CONTEXT_EVIDENCE_DIR)
  throw new Error('Live launcher requires a fresh private evidence directory');
const path = pinNodeRuntimeWithoutVendorShadow(process.env.PATH ?? '', dirname(process.execPath));
const executable = canonicalExecutableOnPath(provider, path);
if (executable === undefined) throw new Error('Canonical provider CLI is unavailable');
const restore = installLiveSpawnPreflight({ provider, executable });
try {
  await import('./context.js');
} finally {
  restore();
}
