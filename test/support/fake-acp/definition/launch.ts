import { fileURLToPath } from 'node:url';

import type { AgentDefinitionInput } from '../../../../src/index.js';
import type { FakeAcpDefinitionOptions } from './options.js';

const fakeBridge = fileURLToPath(new URL('../agent.ts', import.meta.url));
const tsxLoader = import.meta.resolve('tsx');

const optionalArgument = (flag: string, value: string | undefined) =>
  value === undefined
    ? []
    : [
        { kind: 'literal' as const, value: flag },
        { kind: 'literal' as const, value },
      ];

export const fakeAcpLaunch = (
  options: FakeAcpDefinitionOptions,
): AgentDefinitionInput['launch'] => ({
  args: [
    { kind: 'literal', value: '--import' },
    { kind: 'literal', value: tsxLoader },
    { kind: 'literal', value: fakeBridge },
    { kind: 'literal', value: '--mode' },
    { kind: 'literal', value: options.mode ?? 'success' },
    ...(options.withWorkspaceArg === true ? [{ kind: 'workspace' as const }] : []),
    ...optionalArgument('--trace', options.traceFile),
    ...optionalArgument('--configuration-state', options.configurationStateFile),
    ...optionalArgument('--descendant-pid', options.descendantPidFile),
    ...optionalArgument('--ready', options.readyFile),
  ],
  command: options.command ?? process.execPath,
  versionProbe: { args: ['--version'], prefix: 'v', stream: 'stdout', timeoutMs: 1_000 },
});
