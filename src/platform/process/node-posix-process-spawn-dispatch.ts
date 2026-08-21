import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import {
  beginProcessStart,
  settleProcessStart,
  type ProcessOutputSink,
  type ProcessSpawnRequest,
  type ProcessStartAttempt,
} from '../../runtime/execution/index.js';

interface NodePosixProcessSpawnHandle {
  readonly child: ChildProcessWithoutNullStreams;
  readonly stdout: ProcessOutputSink;
  readonly stderr: ProcessOutputSink;
}

const PROCESS_SPAWN_HANDLES = new WeakMap<ProcessStartAttempt, NodePosixProcessSpawnHandle>();

const copyEnvironment = (environment: Readonly<Record<string, string>>): Record<string, string> => {
  const entries = Object.entries(environment);
  if (entries.some(([, value]) => typeof value !== 'string'))
    throw new Error('Process environment values must be strings.');

  return Object.fromEntries(entries);
};

const clearEnvironment = (environment: Record<string, string>): void => {
  for (const key of Object.keys(environment)) delete environment[key];
};

const assertOutputSink: (value: unknown, name: string) => asserts value is ProcessOutputSink = (
  value,
  name,
) => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('write' in value) ||
    typeof value.write !== 'function' ||
    !('end' in value) ||
    typeof value.end !== 'function'
  )
    throw new Error(`${name} output sink must provide write and end functions.`);
};

export class NodePosixProcessSpawnDispatch {
  beginStart(attempt: ProcessStartAttempt, request: ProcessSpawnRequest): void {
    beginProcessStart(attempt, () => {
      this.dispatch(attempt, request);
    });
  }

  handle(attempt: ProcessStartAttempt): NodePosixProcessSpawnHandle | undefined {
    return PROCESS_SPAWN_HANDLES.get(attempt);
  }

  private dispatch(attempt: ProcessStartAttempt, request: ProcessSpawnRequest): void {
    let environment: Record<string, string>;
    try {
      assertOutputSink(request.stdout, 'stdout');
      assertOutputSink(request.stderr, 'stderr');
      environment = copyEnvironment(request.environment);
    } catch {
      settleProcessStart(attempt, { status: 'failed' });
      return;
    }

    const args = [...request.args];
    const child = spawn(request.executable, args, {
      cwd: request.cwd,
      detached: true,
      env: environment,
      shell: request.shell,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    args.length = 0;
    clearEnvironment(environment);

    child.once('spawn', () => {
      const spawnedAt = Date.now();
      PROCESS_SPAWN_HANDLES.set(
        attempt,
        Object.freeze({
          child,
          stdout: request.stdout,
          stderr: request.stderr,
        }),
      );
      settleProcessStart(attempt, { status: 'accepted', spawnedAt });
    });
    child.once('error', () => {
      settleProcessStart(attempt, { status: 'failed' });
    });
  }
}
