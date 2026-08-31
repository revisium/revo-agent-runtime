import { expect, test } from 'vitest';

import { validateAgentDefinition } from '../../../src/definition/index.js';
import { discoverAgents, type AgentDetector } from '../../../src/index.js';
import { detectedDefinition, detectorDiagnostic } from '../../support/builders/discovery.js';

test('discovers extension definitions in deterministic order with result-scoped observations', async () => {
  const zeta: AgentDetector = {
    id: 'zeta',
    detect: async () => ({
      candidates: [
        {
          definition: detectedDefinition('zeta'),
          defaultModelId: 'z',
          models: [
            { displayName: 'Zed', id: 'z' },
            { displayName: 'Alpha', id: 'alpha' },
            { id: 'z' },
          ],
        },
      ],
      diagnostics: [detectorDiagnostic('zeta_checked')],
    }),
  };
  const alpha: AgentDetector = {
    id: 'alpha',
    detect: async () => ({
      candidates: [{ definition: detectedDefinition('alpha'), models: [] }],
      diagnostics: [],
    }),
  };

  const result = await discoverAgents({
    detectors: [zeta, alpha],
    includeBuiltInDetectors: false,
  });

  expect(result.definitions.map(({ id }) => id)).toEqual(['alpha', 'zeta']);
  expect(result.diagnostics).toEqual([
    { ...detectorDiagnostic('zeta_checked'), detectorId: 'zeta' },
  ]);
  expect(result.modelObservations).toEqual([
    {
      defaultModelId: 'z',
      definitionIndex: 1,
      detectorId: 'zeta',
      models: [
        { displayName: 'Alpha', id: 'alpha' },
        { displayName: 'Zed', id: 'z' },
      ],
    },
  ]);
});

test('replays definitions byte-equivalently and keeps observations out of their digest', async () => {
  const withModels = (modelId: string): AgentDetector => ({
    id: 'fixture',
    detect: async () => ({
      candidates: [
        {
          definition: detectedDefinition('fixture'),
          defaultModelId: modelId,
          models: [{ id: modelId }],
        },
      ],
      diagnostics: [],
    }),
  });

  const first = await discoverAgents({
    detectors: [withModels('one')],
    includeBuiltInDetectors: false,
  });
  const replay = await discoverAgents({
    detectors: [withModels('one')],
    includeBuiltInDetectors: false,
  });
  const changedModels = await discoverAgents({
    detectors: [withModels('two')],
    includeBuiltInDetectors: false,
  });

  expect(first.definitions).toEqual(replay.definitions);
  expect(validateAgentDefinition(first.definitions[0]).canonicalBytes()).toEqual(
    validateAgentDefinition(replay.definitions[0]).canonicalBytes(),
  );
  expect(validateAgentDefinition(first.definitions[0]).digest).toBe(
    validateAgentDefinition(changedModels.definitions[0]).digest,
  );
  expect(first.modelObservations).not.toEqual(changedModels.modelObservations);
});

test('supports disabling built-in and extension detectors without credential access', async () => {
  let invoked = false;
  const disabled: AgentDetector = {
    id: 'disabled',
    detect: async () => {
      invoked = true;
      return { candidates: [], diagnostics: [] };
    },
  };

  const result = await discoverAgents({
    detectors: [disabled],
    disabledDetectorIds: [
      'disabled',
      'antigravity',
      'claude',
      'cline',
      'codex',
      'copilot',
      'cursor',
      'gemini',
      'goose',
      'grok',
      'hermes',
      'kilo',
      'kimi',
      'opencode',
      'qwen',
      'vibe',
    ],
  });

  expect(invoked).toBe(false);
  expect(result).toEqual({ definitions: [], diagnostics: [], modelObservations: [] });
});

test('accepts empty public options without constructing an extension detector', async () => {
  const result = await discoverAgents({ includeBuiltInDetectors: false });

  expect(result).toEqual({ definitions: [], diagnostics: [], modelObservations: [] });
});

test('keeps extension input order when detector identifiers compare equally', async () => {
  const first: AgentDetector = {
    id: 'same',
    detect: async () => ({
      candidates: [{ definition: detectedDefinition('first'), models: [] }],
      diagnostics: [],
    }),
  };
  const second: AgentDetector = {
    id: 'same',
    detect: async () => ({
      candidates: [{ definition: detectedDefinition('second'), models: [] }],
      diagnostics: [],
    }),
  };

  const result = await discoverAgents({
    detectors: [first, second],
    includeBuiltInDetectors: false,
  });

  expect(result.definitions.map(({ id }) => id)).toEqual(['first', 'second']);
});

test('propagates a supplied signal and does not run a detector after it is aborted', async () => {
  const controller = new AbortController();
  let propagated = false;
  let calls = 0;
  const observing: AgentDetector = {
    id: 'observing',
    detect: async ({ signal }) => {
      calls += 1;
      propagated = signal === controller.signal;
      return { candidates: [], diagnostics: [] };
    },
  };
  await discoverAgents({
    detectors: [observing],
    includeBuiltInDetectors: false,
    signal: controller.signal,
  });
  controller.abort();

  await discoverAgents({
    detectors: [observing],
    includeBuiltInDetectors: false,
    signal: controller.signal,
  });

  expect(propagated).toBe(true);
  expect(calls).toBe(1);
});

test('reports credential-free model enumeration as unavailable without a model call', async () => {
  const result = await discoverAgents({ detectors: [], includeBuiltInDetectors: true });

  expect(result.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: 'model_enumeration_unavailable', severity: 'info' }),
    ]),
  );
});
