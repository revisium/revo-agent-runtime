import assert from 'node:assert/strict';

import { expectRuleFailure, expectRuleSuccess } from '../../../negative-assertions.js';
import {
  importSpecifiers,
  resolvedRelativeModule,
  type SourceModule,
} from '../../../source-modules.js';

interface ParsedImportProbe {
  readonly id: string;
  readonly module: SourceModule;
  readonly specifier: string;
  readonly target: string;
  readonly allowed: boolean;
}

const parsedImport = (probe: ParsedImportProbe): SourceModule => {
  const specifiers = importSpecifiers(probe.module.source);
  assert.deepEqual(specifiers, [probe.specifier], `[${probe.id}] extracted specifier`);
  assert.equal(
    resolvedRelativeModule(probe.module.path, probe.specifier),
    probe.target,
    `[${probe.id}] resolved target`,
  );
  return probe.module;
};

const parsedImportProbes: readonly ParsedImportProbe[] = [
  {
    id: 'contracts-session.sibling-import-type.allowed',
    module: {
      path: 'src/contracts/session/api/manager.ts',
      source: "import type { AgentSession } from './session.js';\nexport type { AgentSession };\n",
    },
    specifier: './session.js',
    target: 'src/contracts/session/api/session.ts',
    allowed: true,
  },
  {
    id: 'contracts-session.sibling-export-type.allowed',
    module: {
      path: 'src/contracts/session.ts',
      source: "export type { AgentSession } from './session/api/session.js';\n",
    },
    specifier: './session/api/session.js',
    target: 'src/contracts/session/api/session.ts',
    allowed: true,
  },
  {
    id: 'protocol-acp-session.contracts-session-import-type.forbidden',
    module: {
      path: 'src/protocol/acp/session/composition/driver.ts',
      source: "import type { AgentSession } from '../../../../contracts/session/api/session.js';\n",
    },
    specifier: '../../../../contracts/session/api/session.js',
    target: 'src/contracts/session/api/session.ts',
    allowed: false,
  },
  {
    id: 'protocol-acp-session.protocol-session-import-type.allowed',
    module: {
      path: 'src/protocol/acp/session/composition/driver.ts',
      source: "import type { ProtocolSession } from '../../../session/port/session.js';\n",
    },
    specifier: '../../../session/port/session.js',
    target: 'src/protocol/session/port/session.ts',
    allowed: true,
  },
];

export const runParsedSessionImportProbes = (): void => {
  for (const probe of parsedImportProbes) {
    const module = parsedImport(probe);
    if (probe.allowed) expectRuleSuccess(module);
    else expectRuleFailure(module, 'layer-dependency');
  }
};
