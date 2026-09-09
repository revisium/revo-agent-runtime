import { join } from 'node:path';

import { test } from 'vitest';

import { expectPrivateOutput } from '../../support/assertions/private-output.js';
import { withTemporaryDirectory } from '../../support/assertions/temporary-directory.js';

test.skipIf(process.platform !== 'win32')(
  'creates a directory accessible only to the runtime user',
  async () => {
    const { createWindowsPrivateDirectory } =
      await import('../../../src/platform/node/output/windows/private-directory.js');
    const { windowsOutputNative } =
      await import('../../../src/platform/node/output/windows/native.js');
    await withTemporaryDirectory(async (directory) => {
      const output = join(directory, 'private-output');
      createWindowsPrivateDirectory(output, windowsOutputNative);
      await expectPrivateOutput([output], 0o700);
    });
  },
  15_000,
);
