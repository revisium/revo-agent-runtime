import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import type { OwnedProcess } from '../../../../src/process/index.js';
import { nodeProcessSpawner } from '../../../../src/process/node.js';

export const processExists = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
};

export class ProcessFixture {
  private readonly input;
  private readonly output;

  private constructor(private readonly process: OwnedProcess) {
    this.input = process.transport.input.getWriter();
    this.output = process.transport.output.pipeThrough(new TextDecoderStream()).getReader();
  }

  get identity() {
    return this.process.identity;
  }

  static async start(): Promise<ProcessFixture> {
    const owned = await nodeProcessSpawner.start(
      {
        command: process.execPath,
        args: [fileURLToPath(new URL('./child.ts', import.meta.url))],
        cwd: process.cwd(),
      },
      AbortSignal.timeout(5_000),
    );
    const fixture = new ProcessFixture(owned);
    try {
      assert.equal(await fixture.read(), 'ready');
      return fixture;
    } catch (error) {
      await fixture.close();
      throw error;
    }
  }

  private async read(text = ''): Promise<unknown> {
    if (text.includes('\n')) return JSON.parse(text) as unknown;
    const { value, done } = await this.output.read();
    if (done) throw new Error('Fixture exited before replying');
    return this.read(text + value);
  }

  private async request(command: string): Promise<unknown> {
    await this.input.write(new TextEncoder().encode(command + '\n'));
    return this.read();
  }

  async spawnDescendant(): Promise<number> {
    const pid = await this.request('spawn');
    if (typeof pid !== 'number') throw new Error('Expected descendant PID');
    return pid;
  }

  ping(): Promise<unknown> {
    return this.request('ping');
  }

  async stop(): Promise<void> {
    assert.equal((await this.process.terminateAndReap()).status, 'confirmed');
  }

  async close(): Promise<void> {
    await this.stop();
    await this.output.cancel();
    this.input.releaseLock();
    this.output.releaseLock();
  }
}

export const assertProcessGone = async (
  pid: number,
  deadline = Date.now() + 3_000,
): Promise<void> => {
  if (!processExists(pid)) return;
  assert.ok(Date.now() < deadline, 'Owned process must be gone');
  await delay(20);
  return assertProcessGone(pid, deadline);
};
