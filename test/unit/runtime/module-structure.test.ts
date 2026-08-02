import { readFile, readdir } from 'node:fs/promises';

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
    'definition/agent-definition-schema/index.ts',
    'definition/agent-definition-schema/parse-and-classify-agent-definition.ts',
    'definition/agent-definition-schema/raw-agent-definition-schema.ts',
    'definition/agent-definition-schema/raw-agent-definition.ts',
    'definition/consumer-schema-validator/compiled-consumer-schema.ts',
    'definition/consumer-schema-validator/compile-consumer-schema.ts',
    'definition/consumer-schema-validator/index.ts',
    'definition/definition-digest/create-definition-identity.ts',
    'definition/definition-digest/definition-identity.ts',
    'definition/definition-digest/index.ts',
    'definition/executable-version-constraint/comparator-operator.ts',
    'definition/executable-version-constraint/executable-version-constraint.ts',
    'definition/executable-version-constraint/index.ts',
    'definition/executable-version-constraint/matches-executable-version-constraint.ts',
    'definition/executable-version-constraint/parse-executable-version-constraint.ts',
    'definition/executable-version-constraint/version-comparator.ts',
    'definition/rfc8785/canonicalize-json-bytes.ts',
    'definition/rfc8785/index.ts',
    'definition/consumer-schema-profile/index.ts',
    'definition/consumer-schema-profile/consumer-schema-profile-validation.ts',
    'definition/consumer-schema-profile/validate-consumer-schema-profile.ts',
    'definition/plain-json/append-pointer-token.ts',
    'definition/plain-json/freeze-json-value.ts',
    'definition/plain-json/index.ts',
    'definition/index.ts',
    'definition/plain-json/inspect-plain-json.ts',
    'definition/plain-json/is-json-array.ts',
    'definition/plain-json/is-json-object.ts',
    'definition/plain-json/parse-canonical-json.ts',
    'definition/plain-json/plain-json-inspection.ts',
    'definition/strict-semver/compare-semver.ts',
    'definition/strict-semver/index.ts',
    'definition/strict-semver/parse-strict-semver.ts',
    'definition/strict-semver/strict-semver.ts',
    'definition/validation-diagnostics/compare-utf8.ts',
    'definition/validation-diagnostics/index.ts',
    'definition/validation-diagnostics/normalize-validation-diagnostics.ts',
    'definition/validation-diagnostics/validation-diagnostic-input.ts',
    'definition/validate-definition/index.ts',
    'definition/validate-definition/validate-manager-options.ts',
    'definition/validate-definition/validated-definition.ts',
    'definition/validate-definition/validated-manager-construction.ts',
    'errors/agent-manager-error.ts',
    'errors/index.ts',
    'execution/bounded-command-port/bounded-command-observation.ts',
    'execution/bounded-command-port/bounded-command-port.ts',
    'execution/bounded-command-port/bounded-command-request.ts',
    'execution/bounded-command-port/command-resolution.ts',
    'execution/bounded-command-port/index.ts',
    'execution/bounded-command-port/running-bounded-command.ts',
    'execution/execution-ports.ts',
    'execution/execution-terminal-observation.ts',
    'execution/finalize-invocation-outcome.ts',
    'execution/input-snapshot.ts',
    'execution/index.ts',
    'execution/lifecycle.ts',
    'execution/normalize-invocation-outcome.ts',
    'execution/normalized-invocation-failure-reason.ts',
    'execution/normalized-invocation-outcome.ts',
    'execution/process-supervision-port/index.ts',
    'execution/process-supervision-port/live-owned-process.ts',
    'execution/process-supervision-port/process-exit-observation.ts',
    'execution/process-supervision-port/process-identity.ts',
    'execution/process-supervision-port/process-output-sink.ts',
    'execution/process-supervision-port/process-start-request.ts',
    'execution/process-supervision-port/process-supervision-port.ts',
    'execution/raw-response-diagnostic.ts',
    'execution/result-schema-validator.ts',
    'execution/workspace-admission-result.ts',
    'policy/fault-messages.ts',
    'policy/index.ts',
    'policy/limits/index.ts',
    'policy/limits/agent-manager-limits.ts',
    'policy/limits/agent-runtime-limits.ts',
    'policy/limits/probe-diagnostic-preview-bytes.ts',
    'probe/index.ts',
    'probe/executable-probe/index.ts',
    'probe/executable-probe/probe-executable.ts',
    'probe/executable-probe/probe-target.ts',
    'probe/executable-probe-port/executable-probe-port.ts',
    'probe/executable-probe-port/executable-resolution.ts',
    'probe/executable-probe-port/index.ts',
    'probe/executable-probe-port/running-version-probe.ts',
    'probe/executable-probe-port/version-probe-observation.ts',
    'probe/executable-probe-port/version-probe-request.ts',
    'probe/version-output/index.ts',
    'probe/version-output/parse-version-output.ts',
    'probe/version-output/version-output-failure-reason.ts',
    'probe/version-output/version-output-result.ts',
    'registry/index.ts',
    'registry/sealed-agent-registry.ts',
    'spec/agent-definition/agent-argument-template.ts',
    'spec/agent-definition/agent-definition-contract.ts',
    'spec/agent-definition/agent-descriptor.ts',
    'spec/agent-definition/agent-version-probe.ts',
    'spec/agent-definition/index.ts',
    'spec/agent-fault/agent-fault.ts',
    'spec/agent-fault/agent-validation-diagnostic.ts',
    'spec/agent-fault/index.ts',
    'spec/agent-probe/agent-probe-result.ts',
    'spec/agent-probe/index.ts',
    'spec/index.ts',
    'spec/json/index.ts',
    'spec/json/json-object-base.ts',
    'spec/json/json-object.ts',
    'spec/json/json-primitive.ts',
    'spec/json/json-schema-2020-12.ts',
    'spec/json/json-value.ts',
    'spec/manager-options/agent-manager-options.ts',
    'spec/manager-options/index.ts',
  ].toSorted();

  expect(actualFiles).toEqual(expectedFiles);

  const sources = await Promise.all(
    actualFiles.map(async (path) => readFile(new URL(path, runtimeRoot), 'utf8')),
  );
  const cryptoImporters = actualFiles.filter((path, index) =>
    sources[index]?.includes("from 'node:crypto'"),
  );

  expect(cryptoImporters).toEqual(['definition/definition-digest/create-definition-identity.ts']);
});
