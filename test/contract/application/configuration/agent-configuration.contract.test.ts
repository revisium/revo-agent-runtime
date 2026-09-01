import { expect, test } from 'vitest';

import { withTemporaryDirectory } from '../../../support/assertions/temporary-directory.js';
import {
  configurationStory,
  grokFallbackStory,
} from '../../../support/stories/configuration-story.js';

test('inspects live session options and applies an explicit configuration before the prompt', async () => {
  await withTemporaryDirectory(async (directory) => {
    const story = configurationStory(directory);
    await story.initialize();

    const catalog = await story.inspect();
    const result = await story.run(
      {
        catalogRevision: catalog.catalogRevision,
        selections: { model: 'provider-b/beta', reasoning_effort: 'high', fast: false },
      },
      'configured-turn',
    );
    const methods = await story.observedRequestMethods();
    await story.shutdown();

    expect(catalog).toMatchObject({
      agent: { id: 'codex', version: '1.0.0' },
      model: {
        currentModel: 'provider-a/alpha',
        currentProvider: { id: 'provider-a', name: 'Provider A' },
        providers: [
          { id: 'provider-a', models: [{ value: 'provider-a/alpha' }] },
          { id: 'provider-b', models: [{ value: 'provider-b/beta' }] },
        ],
      },
      options: [
        { category: 'model', currentValue: 'provider-a/alpha', id: 'model', type: 'select' },
        { category: 'thought_level', currentValue: 'medium', id: 'reasoning_effort' },
        { currentValue: true, id: 'fast', type: 'boolean' },
      ],
      schemaVersion: 'agent-configuration-catalog/v1',
    });
    expect(result).toMatchObject({ status: 'succeeded' });
    expect(methods.filter((method) => method === 'session/set_config_option')).toHaveLength(3);
    expect(methods.indexOf('session/set_config_option')).toBeLessThan(
      methods.indexOf('session/prompt'),
    );
  });
});

test('preserves an ACP default empty select identifier through a public configuration request', async () => {
  await withTemporaryDirectory(async (directory) => {
    const story = configurationStory(directory, { mode: 'configuration-empty-default' });
    await story.initialize();

    const catalog = await story.inspect();
    const result = await story.run(
      { catalogRevision: catalog.catalogRevision, selections: { agent: '' } },
      'default-agent-turn',
    );
    const values = await story.observedSelectValues();
    await story.shutdown();

    expect(catalog.options).toContainEqual({
      category: '_agent',
      currentValue: '',
      id: 'agent',
      name: 'Agent',
      type: 'select',
      values: [
        { description: 'Default Copilot agent', name: 'Copilot', value: '' },
        { name: 'Code reviewer', value: 'code-reviewer' },
      ],
    });
    expect(result).toMatchObject({ status: 'succeeded' });
    expect(values).toContainEqual({ configId: 'agent', sessionId: 'fake-acp-session', value: '' });
  });
});

test('round-trips a bridge-reported current select value outside its public picker', async () => {
  await withTemporaryDirectory(async (directory) => {
    const story = configurationStory(directory, { mode: 'configuration-current-outside-picker' });
    await story.initialize();

    const catalog = await story.inspect();
    const result = await story.run(
      { catalogRevision: catalog.catalogRevision, selections: { model: 'bridge-current' } },
      'bridge-current-turn',
    );
    const values = await story.observedSelectValues();
    await story.shutdown();

    expect(catalog.options.find((option) => option.id === 'model')).toEqual({
      category: 'model',
      currentValue: 'bridge-current',
      id: 'model',
      name: 'Model',
      type: 'select',
      values: [
        {
          group: { id: 'provider-a', name: 'Provider A' },
          name: 'Alpha',
          value: 'provider-a/alpha',
        },
        {
          group: { id: 'provider-b', name: 'Provider B' },
          name: 'Beta',
          value: 'provider-b/beta',
        },
      ],
    });
    expect(result).toMatchObject({ status: 'succeeded' });
    expect(values).toContainEqual({
      configId: 'model',
      sessionId: 'fake-acp-session',
      value: 'bridge-current',
    });
  });
});

test('rejects a stale removed model before sending a prompt', async () => {
  await withTemporaryDirectory(async (directory) => {
    const story = configurationStory(directory, { stateful: true });
    await story.changeCatalogModel('legacy');
    await story.initialize();
    const catalog = await story.inspect();
    await story.changeCatalogModel('current');

    const result = await story.run(
      { catalogRevision: catalog.catalogRevision, selections: { model: 'legacy' } },
      'stale-turn',
    );
    const methods = await story.observedRequestMethods();
    await story.shutdown();

    expect(result).toMatchObject({
      error: { code: 'revo.agent.configuration_stale' },
      status: 'failed',
    });
    expect(methods).not.toContain('session/prompt');
  });
});

test('adopts each returned option list before validating the next selection', async () => {
  await withTemporaryDirectory(async (directory) => {
    const story = configurationStory(directory);
    await story.initialize();
    const catalog = await story.inspect();

    const result = await story.run(
      {
        catalogRevision: catalog.catalogRevision,
        selections: { model: 'provider-b/beta', reasoning_effort: 'low' },
      },
      'rebuilt-options',
    );
    const methods = await story.observedRequestMethods();
    await story.shutdown();

    expect(result).toMatchObject({
      error: { code: 'revo.agent.configuration_value_unsupported' },
      status: 'failed',
    });
    expect(methods.filter((method) => method === 'session/set_config_option')).toHaveLength(1);
    expect(methods).not.toContain('session/prompt');
  });
});

test('maps a malformed provider configuration response to an ordinary protocol failure', async () => {
  await withTemporaryDirectory(async (directory) => {
    const story = configurationStory(directory, { mode: 'configuration-invalid-after-set' });
    await story.initialize();
    const catalog = await story.inspect();

    const result = await story.run(
      { catalogRevision: catalog.catalogRevision, selections: { model: 'provider-b/beta' } },
      'invalid-provider-options',
    );
    await story.shutdown();

    expect(result).toMatchObject({
      error: { code: 'revo.agent.protocol_failed' },
      status: 'failed',
    });
  });
});

test('cancels, closes, and reaps a blocked configuration inspection', async () => {
  await withTemporaryDirectory(async (directory) => {
    const story = configurationStory(directory, { mode: 'configuration-hang' });
    await story.initialize();
    const inspection = story.beginBlockedInspection();
    await inspection.ready();

    inspection.cancel();

    await expect(inspection.result).rejects.toMatchObject({
      fault: { code: 'revo.agent.cancelled' },
    });
    await expect(story.shutdown()).resolves.toBeUndefined();
  });
});

test('times out and reaps an idle configuration inspection', async () => {
  await withTemporaryDirectory(async (directory) => {
    const story = configurationStory(directory, {
      limits: { idleTimeoutMs: 1_000, wallClockTimeoutMs: 2_000 },
      mode: 'configuration-hang',
    });
    await story.initialize();

    await expect(story.inspect()).rejects.toMatchObject({
      fault: { code: 'revo.agent.timeout' },
    });
    await expect(story.shutdown()).resolves.toBeUndefined();
  });
});

test('uses the bounded grok models command only when session metadata is absent', async () => {
  await withTemporaryDirectory(async (directory) => {
    const story = await grokFallbackStory(directory);
    await story.initialize();

    const catalog = await story.inspect();

    await story.shutdown();
    expect(catalog).toMatchObject({
      agent: { id: 'grok-acp', version: '1.0.0' },
      model: {
        currentModel: 'grok-4.6',
        sessionAvailable: [{ value: 'grok-4.6' }, { value: 'grok-4.5' }],
      },
    });
  });
});
