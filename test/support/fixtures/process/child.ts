import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';

let descendant: ChildProcess | undefined;

process.on('SIGTERM', () => {
  if (!descendant || descendant.exitCode !== null || descendant.signalCode !== null) {
    process.exit(0);
  }
  // A group signal reaches both processes. Reap the descendant before exiting.
  void once(descendant, 'exit').then(() => process.exit(0));
});

if (process.argv[2] === 'descendant') {
  process.send?.('ready');
  setInterval(() => {}, 1_000);
} else {
  const reply = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n');
  const input = createInterface({ input: process.stdin });
  input.on('line', (command) => {
    if (command === 'ping') reply('alive');
    if (command === 'spawn') {
      descendant = fork(import.meta.filename, ['descendant'], {
        execArgv: [],
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      });
      descendant.once('message', () => reply(descendant?.pid));
    }
  });
  reply('ready');
}
