import { expect, test } from 'vitest';

import { openCodeProviderPolicy } from '../../../../src/providers/opencode/definition.js';

test('activates OpenCode stderr diagnostics without changing the ACP command', () => {
  const definition = openCodeProviderPolicy.definition('/usr/local/bin/opencode');

  expect(definition.launch.command).toBe('/usr/local/bin/opencode');
  expect(definition.launch.args).toEqual([{ kind: 'literal', value: 'acp' }]);
  expect(definition.launch.environment).toEqual({ OPENCODE_PRINT_LOGS: '1' });
});
