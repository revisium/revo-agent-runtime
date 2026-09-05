import { expect, test } from 'vitest';

import {
  agentSmokeProviders,
  builtInProviderIds,
  configurationSmokeProviders,
  sessionSmokeProviders,
} from '../../smoke/support/provider-selection.js';

test('allows every built-in provider to be selected individually by both manual smokes', () => {
  for (const provider of builtInProviderIds) {
    expect(agentSmokeProviders(provider)).toEqual([provider]);
    expect(configurationSmokeProviders(provider)).toEqual([provider]);
    expect(sessionSmokeProviders(provider)).toEqual([provider]);
  }
});

test('keeps the session all set explicit to the required live matrix', () => {
  expect(sessionSmokeProviders('all')).toEqual(['codex', 'claude', 'opencode']);
});

test('keeps agent all as the accepted ready set and configuration all as every built-in', () => {
  expect(agentSmokeProviders('all')).toEqual(['codex', 'claude', 'grok']);
  expect(configurationSmokeProviders('all')).toEqual(builtInProviderIds);
  expect(configurationSmokeProviders('gemini')).toEqual(['gemini']);
});

test.each([
  ['agent', agentSmokeProviders, 'REVO_LIVE_AGENT_SMOKE'],
  ['configuration', configurationSmokeProviders, 'REVO_LIVE_CONFIGURATION_SMOKE'],
  ['session', sessionSmokeProviders, 'REVO_LIVE_SESSION_SMOKE'],
] as const)('rejects unsupported %s selection', (_label, select, variable) => {
  expect(() => select('unsupported')).toThrow(variable);
});
