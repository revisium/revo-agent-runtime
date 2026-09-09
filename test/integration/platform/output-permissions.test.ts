import { join } from 'node:path';

import { expect, test } from 'vitest';

import { createNodeClaimedOutputPublisher } from '../../../src/platform/node/output/publication.js';
import { expectPrivateOutput } from '../../support/assertions/private-output.js';
import { withTemporaryDirectory } from '../../support/assertions/temporary-directory.js';
import { claimOutput, outputPublication } from '../../support/fixtures/claimed-output.js';

test('restricts the claimed directory and every published file to the runtime user', async () => {
  await withTemporaryDirectory(async (directory) => {
    const claimed = await claimOutput(directory);
    const output = join(directory, 'output');
    const published = await createNodeClaimedOutputPublisher().publish(
      claimed,
      outputPublication(output, new TextEncoder().encode('raw response')),
    );
    expect(published.status).toBe('published');

    await expectPrivateOutput([
      { path: output, mode: 0o700 },
      ...published.files.map((name) => ({ path: join(output, name), mode: 0o600 })),
    ]);
  });
}, 15_000);
