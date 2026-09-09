import { expect, test } from 'vitest';

import { validateAgentDefinition } from '../../../../src/definition/index.js';
import { launchEnvironment } from '../../../../src/execution/process/launch-environment.js';
import { agentDefinition } from '../../../support/builders/agent-definition.js';

const base = agentDefinition();
const definition = validateAgentDefinition({
  ...base,
  launch: { ...base.launch, environment: { CODEX_PATH: '/installed/codex' } },
}).definition;

test('preserves the selected CLI binding while passing unrelated context variables', () => {
  expect(launchEnvironment(definition, { CODEX_PATH: '/wrong/codex', HOME: '/user' })).toEqual({
    CODEX_PATH: '/installed/codex',
    HOME: '/user',
  });
});

test('removes differently cased aliases of a bound variable for Windows environments', () => {
  expect(launchEnvironment(definition, { codex_path: '/wrong/codex' })).toEqual({
    CODEX_PATH: '/installed/codex',
  });
});

test('supplies definition bindings without a launch context', () => {
  expect(launchEnvironment(definition)).toEqual({ CODEX_PATH: '/installed/codex' });
});
