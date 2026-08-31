import { expect, test } from 'vitest';

import {
  agentSmokeProviders,
  builtInProviderIds,
  configurationSmokeProviders,
} from '../../smoke/support/provider-selection.js';

test('allows every built-in provider to be selected individually by both manual smokes', () => {
  for (const provider of builtInProviderIds) {
    expect(agentSmokeProviders(provider)).toEqual([provider]);
    expect(configurationSmokeProviders(provider)).toEqual([provider]);
  }
});

test('keeps agent all as the accepted ready set and configuration all as every built-in', () => {
  expect(agentSmokeProviders('all')).toEqual(['codex', 'claude', 'grok']);
  expect(configurationSmokeProviders('all')).toEqual(builtInProviderIds);
  expect(configurationSmokeProviders('gemini')).toEqual(['gemini']);
});

test.each([
  ['agent', agentSmokeProviders, 'REVO_LIVE_AGENT_SMOKE'],
  ['configuration', configurationSmokeProviders, 'REVO_LIVE_CONFIGURATION_SMOKE'],
] as const)('rejects unsupported %s selection', (_label, select, variable) => {
  expect(() => select('unsupported')).toThrow(variable);
});
