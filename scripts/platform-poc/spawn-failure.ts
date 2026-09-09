import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createNodeProcessSpawner } from '../../src/platform/node/process/spawner.js';

const directory = await mkdtemp(join(tmpdir(), 'revo-missing-process-'));
let inspections = 0;
const spawner = createNodeProcessSpawner(async () => {
  inspections += 1;
  throw new Error('An unstarted process cannot have an identity.');
});

try {
  await assert.rejects(
    spawner.start(
      { command: join(directory, 'missing'), args: [], cwd: directory },
      new AbortController().signal,
    ),
  );
  assert.equal(inspections, 0);
} finally {
  await rm(directory, { recursive: true, force: true });
}
