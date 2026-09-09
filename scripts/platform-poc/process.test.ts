import assert from 'node:assert/strict';
import { test } from 'node:test';

import koffi from 'koffi';

import { ProcessFixture } from './fixture.js';
import { createPlatform } from './platform.js';

console.info({
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  ffi: koffi.version,
});

const platform = await createPlatform();

await test('native identity is stable while the same process is alive', async () => {
  const first = await platform.inspect(process.pid);
  assert.ok(first);
  assert.deepEqual(await platform.inspect(process.pid), first);
});

await test('owned shutdown terminates the admitted parent and its child', async () => {
  const fixture = await ProcessFixture.start(platform);
  try {
    const descendant = await fixture.spawnDescendant();
    assert.ok(await platform.inspect(descendant));

    await fixture.stop();

    assert.equal(await platform.inspect(fixture.identity.pid), undefined);
    assert.equal(await platform.inspect(descendant), undefined);
  } finally {
    await fixture.close();
  }
});

await test('a stale identity cannot terminate a live process', async () => {
  const fixture = await ProcessFixture.start(platform);
  try {
    await assert.rejects(
      fixture.stop({ ...fixture.identity, token: 'a-different-process' }),
      /Process identity does not match/,
    );

    assert.equal(await fixture.ping(), 'alive');
  } finally {
    await fixture.close();
  }
});
