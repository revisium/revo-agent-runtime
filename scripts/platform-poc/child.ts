import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';

if (!process.send) throw new Error('Fixture requires IPC');
const send = process.send.bind(process);
let descendant: ChildProcess | undefined;

// Failure-only harness teardown. Normal SIGTERM below must prove group delivery.
const emergencyCleanup = async (): Promise<void> => {
  if (descendant && descendant.exitCode === null && descendant.signalCode === null) {
    const exited = once(descendant, 'exit');
    descendant.kill('SIGKILL');
    await exited;
  }
  process.exit(70);
};

process.on('message', (message: unknown) => {
  if (message === 'cleanup') void emergencyCleanup();
  if (message === 'ping') send('alive');
  if (message === 'spawn') {
    // Ownership admission has completed before this cooperative fixture forks.
    const child = fork(import.meta.filename, ['descendant'], { execArgv: [] });
    descendant = child;
    child.once('message', () => {
      if (child.pid === undefined) throw new Error('Missing descendant PID');
      send(child.pid);
    });
  }
});
process.on('disconnect', () => {
  void emergencyCleanup();
});
setTimeout(() => {
  void emergencyCleanup();
}, 15_000).unref();
process.on('SIGTERM', () => {
  if (!descendant || descendant.exitCode !== null || descendant.signalCode !== null)
    process.exit(0);
  // The group signal reaches both processes; reap the child before exiting.
  void once(descendant, 'exit').then(() => process.exit(0));
});
send('ready');
setInterval(() => {}, 1_000);
