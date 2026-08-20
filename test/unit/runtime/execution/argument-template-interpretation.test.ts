import { expect, test } from 'vitest';

import { interpretArgumentTemplate } from '../../../../src/runtime/execution/index.js';
import type { AgentArgumentTemplate } from '../../../../src/runtime/spec/index.js';
import { CodexPermissionStrategy } from '../../../../src/strategies/permissions/index.js';

const baseRequest = (template: readonly AgentArgumentTemplate[]) => ({
  template,
  effectiveParameters: Object.freeze({ model: 'gpt-5' }),
  effectivePermissions: Object.freeze({ mode: 'workspace-write', network: false }),
  outputResourcePlan: Object.freeze({
    invocationId: 'template-test',
    outputDirectory: '/outputs/invocation',
    needsPromptFile: true,
    needsResultSchemaFile: true,
  }),
  permissionStrategy: CodexPermissionStrategy,
  workspace: Object.freeze({ status: 'admitted' as const, directory: '/workspace/project' }),
});

test('omits optional missing parameters and rejects required missing parameters', () => {
  expect(
    interpretArgumentTemplate(
      baseRequest([{ kind: 'parameter', name: 'missing', omitIfMissing: true }]),
    ),
  ).toEqual({ status: 'interpreted', template: [{ kind: 'arguments', arguments: [] }] });

  expect(interpretArgumentTemplate(baseRequest([{ kind: 'parameter', name: 'missing' }]))).toEqual({
    status: 'rejected',
  });
});

test('rejects parameters that cannot render to canonical JSON arguments', () => {
  expect(
    interpretArgumentTemplate({
      ...baseRequest([{ kind: 'parameter', name: 'notFinite' }]),
      effectiveParameters: Object.freeze({
        notFinite: Number.POSITIVE_INFINITY,
      }),
    }),
  ).toEqual({ status: 'rejected' });
});

test('rejects file-delivery template items when no matching resource slot was planned', () => {
  expect(
    interpretArgumentTemplate({
      ...baseRequest([{ kind: 'prompt-file' }]),
      outputResourcePlan: Object.freeze({
        invocationId: 'template-test',
        outputDirectory: '/outputs/invocation',
        needsPromptFile: false,
        needsResultSchemaFile: true,
      }),
    }),
  ).toEqual({ status: 'rejected' });

  expect(
    interpretArgumentTemplate({
      ...baseRequest([{ kind: 'result-schema-file' }]),
      outputResourcePlan: Object.freeze({
        invocationId: 'template-test',
        outputDirectory: '/outputs/invocation',
        needsPromptFile: true,
        needsResultSchemaFile: false,
      }),
    }),
  ).toEqual({ status: 'rejected' });
});
