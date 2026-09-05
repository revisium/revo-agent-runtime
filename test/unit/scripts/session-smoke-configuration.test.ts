import { expect, test } from 'vitest';

import type { AgentConfigurationCatalog } from '../../../src/index.js';
import {
  configurationForSessionSmoke,
  preferredModelForSessionSmoke,
} from '../../smoke/session/configuration.js';

const catalog = {
  agent: { id: 'claude-acp', version: '0.70.0' },
  catalogRevision: 'revision',
  definitionDigest: 'digest',
  launch: { executable: 'claude', reportedVersion: '0.70.0' },
  options: [
    {
      category: 'model',
      currentValue: 'unsupported-default',
      id: 'model',
      name: 'Model',
      type: 'select',
      values: [
        { name: 'Default', value: 'unsupported-default' },
        { name: 'Sonnet', value: 'sonnet' },
      ],
    },
    {
      category: 'thought_level',
      currentValue: 'high',
      id: 'effort',
      name: 'Effort',
      type: 'select',
      values: [
        { name: 'Low', value: 'low' },
        { name: 'High', value: 'high' },
      ],
    },
    { currentValue: true, id: 'fast', name: 'Fast', type: 'boolean' },
  ],
  schemaVersion: 'agent-configuration-catalog/v1',
} as const satisfies AgentConfigurationCatalog;

test('selects an explicit supported live model and cheapest thought level', () => {
  expect(configurationForSessionSmoke(catalog, 'sonnet')).toEqual({
    catalogRevision: 'revision',
    selections: { effort: 'low', fast: true, model: 'sonnet' },
  });
});

test('fails instead of silently substituting an unavailable requested model', () => {
  expect(() => configurationForSessionSmoke(catalog, 'missing')).toThrow(
    'Requested smoke model is unavailable.',
  );
});

test('keeps the inspected current model when no explicit model is requested', () => {
  expect(configurationForSessionSmoke(catalog)).toEqual({
    catalogRevision: 'revision',
    selections: { effort: 'low', fast: true, model: 'unsupported-default' },
  });
});

test('pins only provider models selected for the live smoke matrix', () => {
  expect(preferredModelForSessionSmoke('claude-acp')).toBe('sonnet');
  expect(preferredModelForSessionSmoke('opencode-acp')).toBe('xai/grok-4.20-0309-non-reasoning');
  expect(preferredModelForSessionSmoke('codex-acp')).toBe('gpt-5.6-luna');
});
