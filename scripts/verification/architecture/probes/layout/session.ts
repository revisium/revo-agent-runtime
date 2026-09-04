import assert from 'node:assert/strict';
import { dirname } from 'node:path';

import type { SourceModule } from '../../source-modules.js';

const genericSessionNames = /^(?:utils|helpers|types|service|managed-session|session-host)\.ts$/;
const sessionProduction =
  /^src\/(?:application\/session\/|contracts\/session(?:\/|\.ts$)|execution\/(?:session\/|output\/session\/|security\/digest\/)|protocol\/(?:session\/|acp\/session\/)|platform\/node\/(?:output\/session\/|security\/digest$|session\/primitives\/))/;
const sessionTest =
  /^test\/(?:types\/session|contract\/(?:fixtures\/session|session)|unit\/(?:application\/session|execution\/session|protocol\/acp\/session)|integration\/session|e2e\/session|support\/session|smoke\/session)\//;
const architectureVerifierModule = /^scripts\/verification\/architecture\//;
const allowedProductionPaths = [
  /^src\/contracts\/session(?:\.ts|\/(?:api\/(?:manager|session|turn)|capabilities\/negotiated|continuation\/envelope|events\/(?:event|sink)|interaction\/(?:request|response)|lifecycle\/(?:checkpoint|result|snapshot)|persistence\/active-state|requests\/(?:open|resume|send))\.ts)$/,
  /^src\/application\/session\/(?:boundary\/(?:checkpoint\/(?:decode|digest)|input\/(?:immutable-json|open|response|resume|send))|handles\/(?:session|turn)|management\/(?:admission\/(?:capacity|reservation)|facade|opening\/(?:open|resume)|recovery\/reconcile|registry\/(?:active|identities|queries|terminal))|policy\/(?:capabilities\/session-support|identity\/identifiers|limits\/(?:defaults|resolve)))\.ts$/,
  /^src\/execution\/(?:output\/session\/publication|security\/digest\/port)\.ts$/,
  /^src\/execution\/session\/(?:interpreter\/(?:checkpoint\/(?:capture|encode)|event\/(?:deliver|encode|message-stream)|output\/(?:collect|publish)|persistence\/active-state|process\/cleanup|provider\/(?:interaction|lifecycle|opening|turn))|kernel\/(?:command\/(?:effect|provider|public|timer)|effect\/(?:event|lifecycle|persistence|provider|public-call)|model\/(?:identity|interaction-state|session-state|turn-state)|projection\/(?:snapshot|terminal-record)|reducer\/(?:checkpoint|interaction|opening|reduce|terminal|transition|turn))|runtime\/(?:actor\/(?:factory|port|session-actor)|calls\/registry|effects\/(?:dispatcher|outcomes|tracker)|mailbox\/(?:credits|drain|queue)|primitives\/identity|resources\/(?:provider-openings|provider-sessions)|timing\/(?:clock|timers)))\.ts$/,
  /^src\/protocol\/session\/(?:errors\/protocol-error|model\/(?:outcome|request|update)|port\/(?:driver|opening|session))\.ts$/,
  /^src\/protocol\/acp\/session\/(?:composition\/driver|configuration\/apply|connection\/(?:handshake|transport)|interaction\/(?:correlation|input|permission)|lifecycle\/(?:checkpoint|fresh|resume|termination)|prompt\/(?:send|updates)|stream\/(?:frames|output))\.ts$/,
  /^src\/platform\/node\/(?:output\/session\/(?:manifest|publisher)|security\/digest|session\/primitives\/identity)\.ts$/,
] as const;
const allowedTestPaths = [
  /^test\/types\/session\/(?:continuation-envelope|public-api)\.ts$/,
  /^test\/contract\/fixtures\/session\/requirements\/source-requirements-v1\.(?:json|sha256)$/,
  /^test\/contract\/fixtures\/session\/public-contract\/agent-session-v1\.(?:vectors\.ts|golden\.(?:json|sha256))$/,
  /^test\/contract\/fixtures\/session\/context\/context-matrix-v1\.(?:json|sha256)$/,
  /^test\/contract\/session\/(?:api|events|interaction|races|recovery)\/[^/]+\.contract\.test\.ts$/,
  /^test\/contract\/session\/specification\/requirements\/source-manifest\.contract\.test\.ts$/,
  /^test\/contract\/session\/specification\/public-contract\/typed-vectors\.contract\.test\.ts$/,
  /^test\/contract\/session\/specification\/context\/generated-matrix\.contract\.test\.ts$/,
  /^test\/unit\/application\/session\/(?:boundary\/(?:checkpoint|input)|management\/(?:admission|recovery|registry))\/[^/]+\.test\.ts$/,
  /^test\/unit\/execution\/session\/(?:interpreter\/(?:checkpoint|event|output|persistence|process)|kernel\/(?:properties|reducer)|runtime\/(?:effects|mailbox|timing))\/[^/]+\.test\.ts$/,
  /^test\/unit\/protocol\/acp\/session\/(?:interaction|lifecycle|prompt)\/[^/]+\.test\.ts$/,
  /^test\/integration\/session\/(?:fresh|interaction|lifecycle|recovery|resume)\/[^/]+\.test\.ts$/,
  /^test\/e2e\/session\/(?:continuation|interactions|lifecycle|races)\/[^/]+\.e2e\.test\.ts$/,
  /^test\/support\/session\/(?:builders\/(?:checkpoint|input)|fakes\/(?:persistence|protocol|timing)|schedules\/(?:effects|lifecycle)|scenarios\/(?:agent|assertions|barriers|consumer|scenario))\/[^/]+\.ts$/,
  /^test\/support\/session\/specification\/(?:canonical\/json-bytes|fixtures\/(?:read|read-requirements))\.ts$/,
  /^test\/smoke\/session\/(?:interaction|provider|report|runner)\/[^/]+\.ts$/,
] as const;

const matches = (path: string, expressions: readonly RegExp[]): boolean =>
  expressions.some((expression) => expression.test(path));

const layoutRule = (path: string): string => {
  if (path.startsWith('src/')) return 'session-production-hierarchy';
  if (path.startsWith('test/unit/')) return 'session-unit-hierarchy';
  if (path.startsWith('test/contract/session/specification/'))
    return 'session-contract-specification-hierarchy';
  if (path.startsWith('test/contract/fixtures/')) return 'session-fixture-hierarchy';
  if (path.startsWith('test/contract/')) return 'session-contract-hierarchy';
  if (path.startsWith('test/integration/')) return 'session-integration-hierarchy';
  if (path.startsWith('test/e2e/')) return 'session-e2e-hierarchy';
  if (path.startsWith('test/support/')) return 'session-support-hierarchy';
  if (path.startsWith('test/smoke/')) return 'session-smoke-hierarchy';
  return 'session-types-hierarchy';
};

const verifySiblingLimit = (
  modules: readonly SourceModule[],
  matchesModule: (path: string) => boolean,
  rule: string,
): void => {
  const matchingModules = modules.filter(({ path }) => matchesModule(path));
  const directories = new Set(matchingModules.map(({ path }) => dirname(path)));
  for (const directory of directories) {
    if (matchingModules.filter((module) => dirname(module.path) === directory).length > 7) {
      throw new Error(`[${rule}] ${directory}`);
    }
  }
};

const verifyArchitectureScriptLayout = (path: string): void => {
  if (!path.startsWith('scripts/verification/architecture/')) return;
  if (/^scripts\/verification\/architecture\/probes\/[^/]+\.ts$/.test(path)) {
    throw new Error(`[architecture-flat-probes] ${path}`);
  }
  if (
    path.startsWith('scripts/verification/architecture/probes/') &&
    !/^scripts\/verification\/architecture\/probes\/(?:dependency\/(?:base|session|session\/(?:parsed-imports|policy-matrix))|(?:layout|size)\/(?:base|session))\.ts$/.test(
      path,
    )
  ) {
    throw new Error(`[architecture-probe-layout] ${path}`);
  }
  if (
    path.startsWith('scripts/verification/architecture/layers/') &&
    !/^scripts\/verification\/architecture\/layers\/(?:base-policy|classify|session-policy|validate)\.ts$/.test(
      path,
    )
  ) {
    throw new Error(`[architecture-layer-layout] ${path}`);
  }
};

export const validateSessionLayout = (modules: readonly SourceModule[]): void => {
  verifySiblingLimit(
    modules,
    (path) => sessionProduction.test(path) || sessionTest.test(path),
    'session-sibling-limit',
  );
  verifySiblingLimit(
    modules,
    (path) => architectureVerifierModule.test(path),
    'architecture-verifier-sibling-limit',
  );
  for (const module of modules) {
    const name = module.path.slice(module.path.lastIndexOf('/') + 1);
    if (
      (sessionProduction.test(module.path) || sessionTest.test(module.path)) &&
      genericSessionNames.test(name)
    ) {
      throw new Error(`[session-generic-name] ${module.path}`);
    }
    if (architectureVerifierModule.test(module.path) && genericSessionNames.test(name)) {
      throw new Error(`[architecture-verifier-generic-name] ${module.path}`);
    }
    if (name === 'session.test.ts') throw new Error(`[session-catch-all-test] ${module.path}`);
    if (sessionProduction.test(module.path) && !matches(module.path, allowedProductionPaths)) {
      throw new Error(`[session-production-hierarchy] ${module.path}`);
    }
    if (sessionTest.test(module.path) && !matches(module.path, allowedTestPaths)) {
      throw new Error(`[${layoutRule(module.path)}] ${module.path}`);
    }
    verifyArchitectureScriptLayout(module.path);
  }
};

const expectLayoutFailure = (path: string, rule: string): void => {
  assert.throws(
    () => validateSessionLayout([{ path, source: 'export {};\n' }]),
    (error: unknown) => error instanceof Error && error.message.includes(`[${rule}]`),
    `Expected [${rule}] to reject the representative session-layout violation.`,
  );
};

const expectLayoutSuccess = (path: string): void => {
  assert.doesNotThrow(() => validateSessionLayout([{ path, source: 'export {};\n' }]));
};

export const runSessionLayoutProbes = (): void => {
  for (const [path, rule] of [
    ['src/execution/session/reduce.ts', 'session-production-hierarchy'],
    ['src/execution/session/kernel/flat.ts', 'session-production-hierarchy'],
    ['src/contracts/session/api/flat.ts', 'session-production-hierarchy'],
    ['src/application/session/policy/flat.ts', 'session-production-hierarchy'],
    ['src/execution/session/runtime/flat.ts', 'session-production-hierarchy'],
    ['src/execution/session/interpreter/flat.ts', 'session-production-hierarchy'],
    ['src/protocol/session/port/flat.ts', 'session-production-hierarchy'],
    ['src/protocol/acp/session/lifecycle/flat.ts', 'session-production-hierarchy'],
    ['src/platform/node/output/session/flat.ts', 'session-production-hierarchy'],
    ['test/types/session/flat.ts', 'session-types-hierarchy'],
    ['test/contract/fixtures/session/flat.json', 'session-fixture-hierarchy'],
    ['test/contract/session/api/flat.test.ts', 'session-contract-hierarchy'],
    [
      'test/contract/session/specification/flat.contract.test.ts',
      'session-contract-specification-hierarchy',
    ],
    ['test/unit/application/session/flat.test.ts', 'session-unit-hierarchy'],
    ['test/unit/execution/session/kernel/flat.test.ts', 'session-unit-hierarchy'],
    ['test/unit/protocol/acp/session/flat.test.ts', 'session-unit-hierarchy'],
    ['test/integration/session/flat.test.ts', 'session-integration-hierarchy'],
    ['test/e2e/session/flat.e2e.test.ts', 'session-e2e-hierarchy'],
    ['test/support/session/flat.ts', 'session-support-hierarchy'],
    ['test/support/session/scenarios/helpers/flat.ts', 'session-support-hierarchy'],
    ['test/smoke/session/flat.ts', 'session-smoke-hierarchy'],
    ['scripts/verification/architecture/probes/flat.ts', 'architecture-flat-probes'],
    ['scripts/verification/architecture/probes/format/session.ts', 'architecture-probe-layout'],
    ['scripts/verification/architecture/layers/policy.ts', 'architecture-layer-layout'],
    ['scripts/verification/architecture/helpers.ts', 'architecture-verifier-generic-name'],
  ] as const)
    expectLayoutFailure(path, rule);
  for (const path of [
    'test/contract/session/specification/requirements/source-manifest.contract.test.ts',
    'test/support/session/specification/fixtures/read-requirements.ts',
    'test/contract/session/specification/public-contract/typed-vectors.contract.test.ts',
    'test/contract/session/specification/context/generated-matrix.contract.test.ts',
  ])
    expectLayoutSuccess(path);
  for (const [path, rule] of [
    [
      'test/contract/session/specification/golden/schema.contract.test.ts',
      'session-contract-specification-hierarchy',
    ],
    [
      'test/contract/session/specification/traceability/exact-set.contract.test.ts',
      'session-contract-specification-hierarchy',
    ],
    [
      'test/support/session/specification/inventory/schema-registry.ts',
      'session-support-hierarchy',
    ],
    [
      'test/contract/fixtures/session/public-contract/agent-session-v1.schema.json',
      'session-fixture-hierarchy',
    ],
  ] as const)
    expectLayoutFailure(path, rule);
  expectLayoutFailure('src/contracts/session/api/helpers.ts', 'session-generic-name');
  expectLayoutFailure('test/e2e/session/lifecycle/session.test.ts', 'session-catch-all-test');
  assert.throws(
    () =>
      validateSessionLayout(
        Array.from({ length: 8 }, (_, index) => ({
          path: `test/support/session/scenarios/agent/vector-${index}.ts`,
          source: 'export {};\n',
        })),
      ),
    /\[session-sibling-limit\]/,
  );
  assert.throws(
    () =>
      validateSessionLayout(
        Array.from({ length: 8 }, (_, index) => ({
          path: `scripts/verification/architecture/module-${index}.ts`,
          source: 'export {};\n',
        })),
      ),
    /\[architecture-verifier-sibling-limit\]/,
  );
};
