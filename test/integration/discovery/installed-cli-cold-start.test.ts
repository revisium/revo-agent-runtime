import { expect, test } from 'vitest';

import { nodeDiscoveryPlatform } from '../../../src/platform/node/discovery/platform.js';
import { codexProviderPolicy } from '../../../src/providers/codex/definition.js';
import { systemExecutable } from '../../support/fixtures/system-executable.js';

test('discovers an installed CLI whose first version check takes longer than five seconds', async () => {
  const fixture = await systemExecutable('slow-version');
  try {
    await expect(
      nodeDiscoveryPlatform.resolveInstalledCli(codexProviderPolicy.cli, fixture.executable),
    ).resolves.toBe(fixture.executable);
  } finally {
    await fixture.dispose();
  }
}, 15_000);
