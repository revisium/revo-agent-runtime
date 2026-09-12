import { expect, test } from 'vitest';

import { projectSelectableAgentConfiguration } from '../../../../src/configuration/selectable.js';
import type {
  AgentConfigurationCatalog,
  AgentConfigurationModelView,
} from '../../../../src/index.js';

const modelView = (
  overrides: Partial<AgentConfigurationModelView> = {},
): AgentConfigurationModelView => ({
  currentModel: 'provider/model',
  optionId: 'model',
  providers: [
    {
      connected: true,
      id: 'provider',
      models: [{ connected: true, name: 'Model', value: 'provider/model' }],
      name: 'Provider',
    },
  ],
  sessionAvailable: [{ name: 'Model', value: 'provider/model' }],
  ...overrides,
});

const catalog = (
  model: AgentConfigurationModelView | null = modelView(),
  options: AgentConfigurationCatalog['options'] = [
    {
      currentValue: 'provider/model',
      id: 'model',
      name: 'Model',
      type: 'select',
      values: [{ name: 'Model', value: 'provider/model' }],
    },
    { currentValue: true, id: 'effort', name: 'Effort', type: 'boolean' },
  ],
): AgentConfigurationCatalog => ({
  agent: { id: 'agent', version: '1', installationId: 'fixture-installation' },
  catalogRevision: 'revision',
  definitionDigest: 'digest',
  launch: { executable: 'agent', reportedVersion: '1' },
  options,
  schemaVersion: 'agent-configuration-catalog/v2',
  ...(model === null ? {} : { model }),
});

test('projects a coherent catalog from connected selectable models', () => {
  const projected = projectSelectableAgentConfiguration(
    catalog(
      modelView({
        currentModel: 'backup/model',
        providers: [
          {
            connected: true,
            id: 'provider',
            models: [
              { connected: true, name: 'Model', value: 'provider/model' },
              { connected: false, name: 'Hidden', value: 'provider/hidden' },
            ],
            name: 'Provider',
          },
          {
            connected: true,
            id: 'backup',
            models: [{ connected: true, name: 'Backup', value: 'backup/model' }],
            name: 'Backup',
          },
          { connected: false, id: 'offline', models: [], name: 'Offline' },
        ],
        sessionAvailable: [
          { name: 'Model', value: 'provider/model' },
          { name: 'Backup', value: 'backup/model' },
          { name: 'Unavailable', value: 'provider/unavailable' },
        ],
      }),
      [
        {
          currentValue: 'provider/model',
          id: 'model',
          name: 'Model',
          type: 'select',
          values: [
            { name: 'Model', value: 'provider/model' },
            { name: 'Backup', value: 'backup/model' },
            { name: 'Unavailable', value: 'provider/unavailable' },
          ],
        },
        { currentValue: true, id: 'effort', name: 'Effort', type: 'boolean' },
      ],
    ),
  );

  expect(projected?.model).toEqual({
    currentModel: 'backup/model',
    currentProvider: { id: 'backup', name: 'Backup' },
    optionId: 'model',
    providers: [
      {
        connected: true,
        id: 'provider',
        models: [{ connected: true, name: 'Model', value: 'provider/model' }],
        name: 'Provider',
      },
      {
        connected: true,
        id: 'backup',
        models: [{ connected: true, name: 'Backup', value: 'backup/model' }],
        name: 'Backup',
      },
    ],
    sessionAvailable: [
      { name: 'Model', value: 'provider/model' },
      { name: 'Backup', value: 'backup/model' },
    ],
  });
  expect(projected?.options[0]).toMatchObject({
    currentValue: 'backup/model',
    values: [
      { name: 'Model', value: 'provider/model' },
      { name: 'Backup', value: 'backup/model' },
    ],
  });
});

test('selects the first selectable model when the current model is unavailable', () => {
  const projected = projectSelectableAgentConfiguration(
    catalog(
      modelView({
        currentModel: 'offline/model',
        providers: [
          {
            connected: true,
            id: 'provider',
            models: [{ connected: true, name: 'Model', value: 'provider/model' }],
            name: 'Provider',
          },
          {
            connected: true,
            id: 'backup',
            models: [{ connected: true, name: 'Backup', value: 'backup/model' }],
            name: 'Backup',
          },
        ],
        sessionAvailable: [
          { name: 'Model', value: 'provider/model' },
          { name: 'Backup', value: 'backup/model' },
        ],
      }),
      [
        {
          currentValue: 'offline/model',
          id: 'model',
          name: 'Model',
          type: 'select',
          values: [
            { name: 'Offline', value: 'offline/model' },
            { name: 'Model', value: 'provider/model' },
            { name: 'Backup', value: 'backup/model' },
          ],
        },
      ],
    ),
  );

  expect(projected?.model).toMatchObject({
    currentModel: 'provider/model',
    currentProvider: { id: 'provider', name: 'Provider' },
  });
  expect(projected?.options[0]).toMatchObject({ currentValue: 'provider/model' });
});

test('omits a catalog when no connected model is selectable in the session', () => {
  const result = projectSelectableAgentConfiguration(
    catalog(
      modelView({
        currentModel: 'offline/model',
        providers: [
          {
            connected: false,
            id: 'offline',
            models: [{ connected: true, name: 'Offline', value: 'offline/model' }],
            name: 'Offline',
          },
        ],
        sessionAvailable: [{ name: 'Offline', value: 'offline/model' }],
      }),
      [
        {
          currentValue: 'offline/model',
          id: 'model',
          name: 'Model',
          type: 'select',
          values: [{ name: 'Offline', value: 'offline/model' }],
        },
      ],
    ),
  );

  expect(result).toBeUndefined();
});

test('omits a catalog when its model option is absent', () => {
  const result = projectSelectableAgentConfiguration(
    catalog(modelView(), [{ currentValue: true, id: 'effort', name: 'Effort', type: 'boolean' }]),
  );

  expect(result).toBeUndefined();
});

test('omits a catalog when its model is disconnected', () => {
  const result = projectSelectableAgentConfiguration(
    catalog(
      modelView({
        providers: [
          {
            connected: true,
            id: 'provider',
            models: [{ connected: false, name: 'Model', value: 'provider/model' }],
            name: 'Provider',
          },
        ],
      }),
    ),
  );

  expect(result).toBeUndefined();
});

test('omits a catalog when the model option excludes the model', () => {
  const result = projectSelectableAgentConfiguration(
    catalog(modelView(), [
      {
        currentValue: 'provider/model',
        id: 'model',
        name: 'Model',
        type: 'select',
        values: [{ name: 'Other', value: 'other/model' }],
      },
    ]),
  );

  expect(result).toBeUndefined();
});

test('omits a catalog when the session excludes the model', () => {
  const result = projectSelectableAgentConfiguration(catalog(modelView({ sessionAvailable: [] })));

  expect(result).toBeUndefined();
});

test('preserves a model catalog when the runtime has no provider evidence', () => {
  const input = catalog(
    modelView({
      providers: [],
      sessionAvailable: [{ name: 'Model', value: 'provider/model' }],
    }),
  );

  expect(projectSelectableAgentConfiguration(input)).toBe(input);
});

test('preserves catalogs without model views', () => {
  const input = catalog(null);

  expect(projectSelectableAgentConfiguration(input)).toBe(input);
});
