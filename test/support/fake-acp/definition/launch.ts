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

/** Node prints its own version; a reported version override prints the fixture's instead. */
const versionProbeArguments = (reportedVersion: string | undefined): readonly string[] =>
  reportedVersion === undefined
    ? ['--version']
    : ['-e', `process.stdout.write(${JSON.stringify(`v${reportedVersion}\n`)})`];

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
    ...(options.resume === 'native'
      ? [{ kind: 'literal' as const, value: '--native-resume' }]
      : []),
    ...optionalArgument('--trace', options.traceFile),
    ...optionalArgument('--configuration-state', options.configurationStateFile),
    ...optionalArgument('--descendant-pid', options.descendantPidFile),
    ...optionalArgument('--ready', options.readyFile),
  ],
  command: options.command ?? process.execPath,
  ...(options.environment === undefined ? {} : { environment: options.environment }),
  versionProbe: {
    args: [...versionProbeArguments(options.reportedVersion)],
    prefix: 'v',
    stream: 'stdout',
    timeoutMs: 1_000,
  },
});
