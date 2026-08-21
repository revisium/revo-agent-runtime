import { expect, test } from 'vitest';

import { InstalledBindingRegistry } from '../../../../src/application/manager/installed-bindings.js';
import { NativeStdioProtocolDriver } from '../../../../src/strategies/protocol-driver/native-stdio/native-stdio-protocol-driver.js';
import { CodexJsonlResultParser } from '../../../../src/strategies/result-parser/index.js';

test('resolves the installed native stdio driver as the real ProtocolDriverPort', () => {
  expect(InstalledBindingRegistry.resolveProtocolDriver('native/stdio-v1')).toBeInstanceOf(
    NativeStdioProtocolDriver,
  );
});

test('creates an installed Codex JSONL parser for native stdout completion', () => {
  expect(InstalledBindingRegistry.resolveResultParser('codex-jsonl/v1', 1_048_576)).toBeInstanceOf(
    CodexJsonlResultParser,
  );
});
