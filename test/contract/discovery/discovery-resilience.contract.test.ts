import { expect, test } from 'vitest';

import { discoverAgents, type AgentDetector } from '../../../src/index.js';
import { detectedDefinition, detectorDiagnostic } from '../../support/builders/discovery.js';

test('isolates a failed detector without erasing valid definitions', async () => {
  const failing: AgentDetector = {
    id: 'broken',
    detect: async () => Promise.reject(new Error('secret')),
  };
  const healthy: AgentDetector = {
    id: 'healthy',
    detect: async () => ({
      candidates: [{ definition: detectedDefinition('healthy'), models: [] }],
      diagnostics: [],
    }),
  };

  const result = await discoverAgents({
    detectors: [failing, healthy],
    includeBuiltInDetectors: false,
  });

  expect(result.definitions.map(({ id }) => id)).toEqual(['healthy']);
  expect(result.diagnostics).toEqual([
    {
      code: 'detector_failed',
      detectorId: 'broken',
      message: 'Detector failed without returning discovery data.',
      severity: 'error',
    },
  ]);
});

test('keeps the first duplicate exact definition and isolates malformed detector data', async () => {
  const first: AgentDetector = {
    id: 'first',
    detect: async () => ({
      candidates: [{ definition: detectedDefinition('shared'), models: [] }],
      diagnostics: [],
    }),
  };
  const duplicate: AgentDetector = {
    id: 'second',
    detect: async () => ({
      candidates: [{ definition: detectedDefinition('shared'), models: [] }],
      diagnostics: [],
    }),
  };
  const malformed: AgentDetector = {
    id: 'third',
    detect: async () => {
      const result = { candidates: [], diagnostics: [] };
      Reflect.set(result, 'candidates', null);
      return result;
    },
  };

  const result = await discoverAgents({
    detectors: [duplicate, malformed, first],
    includeBuiltInDetectors: false,
  });

  expect(result.definitions.map(({ id }) => id)).toEqual(['shared']);
  expect(result.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: 'duplicate_definition', detectorId: 'second' }),
      expect.objectContaining({ code: 'detector_failed', detectorId: 'third' }),
    ]),
  );
});

test('contains malformed diagnostics and candidates while retaining well-formed observations', async () => {
  const malformedDiagnostic: AgentDetector = {
    id: 'bad-diagnostic',
    detect: async () => {
      const result = { candidates: [], diagnostics: [{ ...detectorDiagnostic('ordinary') }] };
      Reflect.set(result.diagnostics[0]!, 'code', null);
      return result;
    },
  };
  const malformedCandidate: AgentDetector = {
    id: 'bad-candidate',
    detect: async () => {
      const invalidDefinition = detectedDefinition('invalid');
      Reflect.set(invalidDefinition, 'id', null);
      const candidate = { definition: detectedDefinition('shape'), models: [] };
      Reflect.set(candidate, 'models', null);
      return {
        candidates: [candidate, { definition: invalidDefinition, models: [] }],
        diagnostics: [],
      };
    },
  };
  const observed: AgentDetector = {
    id: 'observed',
    detect: async () => ({
      candidates: [{ definition: detectedDefinition('observed'), models: [{ id: 'available' }] }],
      diagnostics: [],
    }),
  };

  const result = await discoverAgents({
    detectors: [malformedDiagnostic, malformedCandidate, observed],
    includeBuiltInDetectors: false,
  });

  expect(result.definitions.map(({ id }) => id)).toEqual(['observed']);
  expect(result.modelObservations).toEqual([
    { definitionIndex: 0, detectorId: 'observed', models: [{ id: 'available' }] },
  ]);
  expect(result.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: 'detector_failed', detectorId: 'bad-diagnostic' }),
      expect.objectContaining({ code: 'definition_invalid', detectorId: 'bad-candidate' }),
    ]),
  );
});

test('does not retain a definition when its model observation is malformed', async () => {
  const malformedModels: AgentDetector = {
    id: 'malformed-models',
    detect: async () => {
      const model = { id: 'available' };
      Reflect.set(model, 'id', null);
      return {
        candidates: [{ definition: detectedDefinition('partial'), models: [model] }],
        diagnostics: [],
      };
    },
  };

  const result = await discoverAgents({
    detectors: [malformedModels],
    includeBuiltInDetectors: false,
  });

  expect(result.definitions).toEqual([]);
  expect(result.modelObservations).toEqual([]);
  expect(result.diagnostics).toEqual([
    expect.objectContaining({ code: 'definition_invalid', detectorId: 'malformed-models' }),
  ]);
});

test('treats definition identity as an exact id and version pair', async () => {
  const detector: AgentDetector = {
    id: 'identity-pairs',
    detect: async () => ({
      candidates: [
        { definition: detectedDefinition('a\u0000b'), models: [] },
        { definition: detectedDefinition('a', 'b\u00001.0.0'), models: [] },
        { definition: detectedDefinition('a', '2.0.0'), models: [] },
      ],
      diagnostics: [],
    }),
  };

  const result = await discoverAgents({
    detectors: [detector],
    includeBuiltInDetectors: false,
  });

  expect(result.definitions.map(({ id, version }) => ({ id, version }))).toEqual([
    { id: 'a\u0000b', version: '1.0.0' },
    { id: 'a', version: 'b\u00001.0.0' },
    { id: 'a', version: '2.0.0' },
  ]);
  expect(result.diagnostics).toEqual([]);
});
