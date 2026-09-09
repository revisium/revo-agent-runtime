import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

import { admitProcess, type AdmittedProcess, type Identity, type Platform } from './platform.js';

const deadline = (): AbortSignal => AbortSignal.timeout(5_000);

export class ProcessFixture {
  private stopped = false;
  private descendant: number | undefined;

  private constructor(
    private readonly child: ChildProcess,
    private readonly platform: Platform,
    private readonly admitted: AdmittedProcess,
  ) {}

  get identity(): Identity {
    return this.admitted.identity;
  }

  static async start(platform: Platform): Promise<ProcessFixture> {
    const child = fork(new URL('./child.ts', import.meta.url), [], {
      detached: process.platform !== 'win32',
      execArgv: [],
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    try {
      await once(child, 'message', { signal: deadline() });
      assert.ok(child.pid);
      return new ProcessFixture(child, platform, await admitProcess(platform, child.pid));
    } catch (error) {
      child.kill('SIGKILL');
      throw error;
    }
  }

  async spawnDescendant(): Promise<number> {
    const response = once(this.child, 'message', { signal: deadline() });
    this.child.send('spawn');
    const pid: unknown = (await response)[0];
    if (typeof pid !== 'number') throw new Error('Expected descendant PID');
    this.descendant = pid;
    return this.descendant;
  }

  async ping(): Promise<unknown> {
    const response = once(this.child, 'message', { signal: deadline() });
    this.child.send('ping');
    return (await response)[0] as unknown;
  }

  async stop(expected: Identity = this.identity): Promise<void> {
    if (this.stopped) return;
    const waiting = new AbortController();
    const exited = once(this.child, 'exit', {
      signal: AbortSignal.any([waiting.signal, deadline()]),
    });
    try {
      await this.admitted.terminate(expected);
      await exited;
    } finally {
      waiting.abort();
      // Remove the event wait after identity rejection as well as normal termination.
      await exited.catch(() => undefined);
    }
    this.stopped = true;
    await this.waitForExit(this.identity.pid, deadline());
    if (this.descendant !== undefined) await this.waitForExit(this.descendant, deadline());
  }

  async close(): Promise<void> {
    try {
      if (!this.stopped) await this.stop();
    } catch (error) {
      try {
        await this.emergencyCleanup();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'PoC failed and fixture cleanup also failed',
          { cause: cleanupError },
        );
      }
      throw error;
    } finally {
      this.admitted.dispose();
    }
  }

  private async emergencyCleanup(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    const exited = once(this.child, 'exit', { signal: AbortSignal.timeout(2_000) });
    if (this.child.connected) this.child.send('cleanup');
    else this.child.kill('SIGKILL');
    try {
      await exited;
    } catch (error) {
      this.child.kill('SIGKILL');
      throw error;
    }
  }
  private async waitForExit(pid: number, signal: AbortSignal): Promise<void> {
    if ((await this.platform.inspect(pid)) === undefined) return;
    await delay(20, undefined, { signal });
    await this.waitForExit(pid, signal);
  }
}
