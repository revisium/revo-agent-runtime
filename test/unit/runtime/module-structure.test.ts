import { readdir } from 'node:fs/promises';

import { expect, test } from 'vitest';

const listFiles = async (directory: URL, prefix = ''): Promise<readonly string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry): Promise<readonly string[]> => {
      const path = `${prefix}${entry.name}`;
      if (!entry.isDirectory()) return [path];

      return listFiles(new URL(`${entry.name}/`, directory), `${path}/`);
    }),
  );

  return files.flat();
};

test('runtime tree comparison is independent of directory enumeration order', async () => {
  const runtimeRoot = new URL('../../../src/runtime/', import.meta.url);

  const actualFiles = (await listFiles(runtimeRoot)).toSorted();
  const expectedFiles = [
    'definition/plain-json/index.ts',
    'definition/index.ts',
    'definition/plain-json/inspect-plain-json.ts',
    'definition/plain-json/plain-json-inspection.ts',
    'definition/validation-diagnostics/index.ts',
    'definition/validation-diagnostics/normalize-validation-diagnostics.ts',
    'definition/validation-diagnostics/validation-diagnostic-input.ts',
    'errors/agent-manager-error.ts',
    'errors/index.ts',
    'policy/fault-messages.ts',
    'policy/index.ts',
    'policy/limits/index.ts',
    'policy/limits/agent-manager-limits.ts',
    'policy/limits/agent-runtime-limits.ts',
    'spec/agent-definition/agent-argument-template.ts',
    'spec/agent-definition/agent-definition-contract.ts',
    'spec/agent-definition/agent-definition-input.ts',
    'spec/agent-definition/agent-descriptor.ts',
    'spec/agent-definition/agent-ref.ts',
    'spec/agent-definition/agent-version-probe.ts',
    'spec/agent-definition/index.ts',
    'spec/agent-fault/agent-fault-code.ts',
    'spec/agent-fault/agent-fault.ts',
    'spec/agent-fault/agent-validation-details.ts',
    'spec/agent-fault/agent-validation-diagnostic.ts',
    'spec/agent-fault/index.ts',
    'spec/agent-probe/agent-probe-available.ts',
    'spec/agent-probe/agent-probe-result.ts',
    'spec/agent-probe/agent-probe-unavailable.ts',
    'spec/agent-probe/index.ts',
    'spec/index.ts',
    'spec/json/index.ts',
    'spec/json/json-object-base.ts',
    'spec/json/json-object.ts',
    'spec/json/json-primitive.ts',
    'spec/json/json-schema-2020-12.ts',
    'spec/json/json-value.ts',
    'spec/manager-options/agent-manager-limits.ts',
    'spec/manager-options/agent-manager-options.ts',
    'spec/manager-options/index.ts',
  ].toSorted();

  expect(actualFiles).toEqual(expectedFiles);
});
