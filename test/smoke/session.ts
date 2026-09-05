import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { discoverAgents, type AgentDefinitionInput } from '../../src/index.js';
import { fakeAcpDefinition } from '../support/fakes/fake-acp.js';
import { preferredModelForSessionSmoke } from './session/configuration.js';
import { formatSessionSmokeEvidence } from './session/evidence.js';
import {
  runSessionCancellationScenario,
  runSessionContinuityScenario,
  runSessionInteractionScenario,
} from './session/runner.js';
import { sessionSmokeProviders, builtInProviderIds } from './support/provider-selection.js';

const selection = process.env.REVO_LIVE_SESSION_SMOKE;
const liveContext = Object.freeze({
  environment: Object.freeze({
    inherit: Object.freeze(['HOME', 'PATH'].filter((name) => process.env[name] !== undefined)),
    secrets: Object.freeze({}),
    variables: Object.freeze({}),
  }),
});

const nonce = (): string => `nonce-${randomBytes(8).toString('hex')}`;

const runProvider = async (
  definition: AgentDefinitionInput,
  directory: string,
  live: boolean,
): Promise<void> => {
  const context = live ? liveContext : undefined;
  const preferredModel = preferredModelForSessionSmoke(definition.id);
  console.log(
    formatSessionSmokeEvidence(
      await runSessionContinuityScenario({
        ...(context === undefined ? {} : { context }),
        definition,
        nonce: nonce(),
        outputDirectory: join(directory, `${definition.id}-continuity`),
        ...(preferredModel === undefined ? {} : { preferredModel }),
        workspaceDirectory: directory,
      }),
    ),
  );
  if (definition.capabilities.cancellation)
    console.log(
      formatSessionSmokeEvidence(
        await runSessionCancellationScenario({
          cancelDelayMs: live ? 1_500 : 10,
          ...(context === undefined ? {} : { context }),
          definition,
          outputDirectory: join(directory, `${definition.id}-cancellation`),
          ...(preferredModel === undefined ? {} : { preferredModel }),
          workspaceDirectory: directory,
        }),
      ),
    );
};

const discoverSelected = async (provider: (typeof builtInProviderIds)[number]) => {
  const discovery = await discoverAgents({
    disabledDetectorIds: builtInProviderIds.filter((candidate) => candidate !== provider),
  });
  return discovery.definitions.find(({ id }) => id === `${provider}-acp`);
};

const safeFailureCode = (error: unknown): string => {
  if (
    typeof error === 'object' &&
    error !== null &&
    'fault' in error &&
    typeof error.fault === 'object' &&
    error.fault !== null &&
    'code' in error.fault &&
    typeof error.fault.code === 'string'
  )
    return error.fault.code;
  if (error instanceof Error) {
    const knownFailure = [
      'Requested smoke model is unavailable.',
      'Selected definition did not advertise session support.',
      'Selected session provider is unavailable.',
      'Session provider did not retain the generated nonce.',
      'Native resume did not retain the generated nonce.',
      'Session smoke left active-state rows behind.',
    ].includes(error.message);
    if (
      knownFailure ||
      /^(?:First|Second|Resumed) session turn ended with [a-z_]+/.test(error.message)
    )
      return error.message;
  }
  return error instanceof Error ? error.name : 'unknown';
};

const runSelected = async (
  providers: readonly (typeof builtInProviderIds)[number][],
  directory: string,
): Promise<boolean> => {
  let failed = false;
  for (const provider of providers) {
    // oxlint-disable-next-line no-await-in-loop -- live providers run sequentially to isolate process and account state
    const definition = await discoverSelected(provider);
    if (definition === undefined) {
      console.log(`${provider}-acp: status=blocked; reason=executable_unavailable`);
      failed = true;
      continue;
    }
    try {
      // oxlint-disable-next-line no-await-in-loop -- each provider must finish cleanup before the next starts
      await runProvider(definition, directory, true);
    } catch (error) {
      console.log(`${definition.id}: status=failed; reason=${safeFailureCode(error)}`);
      failed = true;
    }
  }
  return failed;
};

const directory = await mkdtemp(join(tmpdir(), 'revo-agent-session-smoke-'));

try {
  console.log('smoke:session');
  console.log(
    formatSessionSmokeEvidence(
      await runSessionContinuityScenario({
        definition: fakeAcpDefinition({ mode: 'session' }),
        nonce: nonce(),
        outputDirectory: join(directory, 'fake-continuity'),
        workspaceDirectory: directory,
      }),
    ),
  );
  console.log(
    formatSessionSmokeEvidence(
      await runSessionCancellationScenario({
        cancelDelayMs: 10,
        definition: fakeAcpDefinition({ mode: 'hang', session: true }),
        outputDirectory: join(directory, 'fake-cancellation'),
        workspaceDirectory: directory,
      }),
    ),
  );
  console.log(
    formatSessionSmokeEvidence(
      await runSessionInteractionScenario({
        definition: fakeAcpDefinition({ mode: 'session-interactions' }),
        outputDirectory: join(directory, 'fake-interactions'),
        workspaceDirectory: directory,
      }),
    ),
  );
  if (selection !== undefined) {
    const failed = await runSelected(sessionSmokeProviders(selection), directory);
    if (failed) process.exitCode = 1;
  }
} finally {
  await rm(directory, { force: true, recursive: true });
}
