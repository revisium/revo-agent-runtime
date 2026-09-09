import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createNodeProcessSpawner } from '../../../../src/process/node/spawner.js';

const directory = await mkdtemp(join(tmpdir(), 'revo-missing-process-'));
const launch = { command: join(directory, 'missing.exe'), args: [], cwd: directory };
let inspections = 0;
const spawner = createNodeProcessSpawner(async () => {
  inspections += 1;
  throw new Error('An unstarted process cannot have an identity.');
});

try {
  await assert.rejects(spawner.start(launch, new AbortController().signal));
  assert.equal(inspections, 0);
} finally {
  await rm(directory, { recursive: true, force: true });
}
