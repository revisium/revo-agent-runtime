import type * as acp from '@agentclientprotocol/sdk';
import { expect, test } from 'vitest';

import type {
  AcpConfigurationCompatibility,
  AcpConfigurationRequester,
} from '../../../../src/protocol/acp/compatibility.js';
import { acpConfigurationRequester } from '../../../../src/protocol/acp/configuration-requester.js';
import {
  AcpConfigurationSelectionError,
  applyAcpConfiguration,
  type AcpConfigurationSession,
} from '../../../../src/protocol/acp/configuration.js';

const selectOption = (currentValue: string = 'one'): acp.SessionConfigOption => ({
  currentValue,
  id: 'model',
  name: 'Model',
  options: [
    { name: 'One', value: 'one' },
    { name: 'Two', value: 'two' },
  ],
  type: 'select',
});

const session = (options: readonly acp.SessionConfigOption[] = []): AcpConfigurationSession =>
  Object.freeze({
    configOptions: options,
    sessionId: 'session',
  });

const context = (response: readonly acp.SessionConfigOption[] = [selectOption('two')]) => {
  const requests: unknown[] = [];
  return {
    requester: {
      request: async (_method: string, params: Readonly<Record<string, unknown>>) => {
        requests.push(params);
        return {};
      },
      setOption: async (params: acp.SetSessionConfigOptionRequest) => {
        requests.push(params);
        return response;
      },
    } satisfies AcpConfigurationRequester,
    requests,
  };
};

test('applies stable select and boolean values and adopts the returned full list', async () => {
  const initial = [
    selectOption(),
    { currentValue: true, id: 'fast', name: 'Fast', type: 'boolean' as const },
  ];
  const returned = [
    selectOption('two'),
    { currentValue: false, id: 'fast', name: 'Fast', type: 'boolean' as const },
  ];
  const fixture = context(returned);

  const catalog = await applyAcpConfiguration(fixture.requester, session(initial), {
    selections: { model: 'one', fast: false },
  });

  expect(fixture.requests).toEqual([
    { configId: 'model', sessionId: 'session', value: 'one' },
    { configId: 'fast', sessionId: 'session', type: 'boolean', value: false },
  ]);
  expect(catalog.options).toMatchObject([{ currentValue: 'two' }, { currentValue: false }]);
});

test('round-trips an empty ACP select identifier unchanged', async () => {
  const defaultAgent: acp.SessionConfigOption = {
    category: '_agent',
    currentValue: '',
    id: 'agent',
    name: 'Agent',
    options: [
      { name: 'Copilot', value: '' },
      { name: 'Code reviewer', value: 'code-reviewer' },
    ],
    type: 'select',
  };
  const fixture = context([defaultAgent]);

  await applyAcpConfiguration(fixture.requester, session([defaultAgent]), {
    selections: { agent: '' },
  });

  expect(fixture.requests).toEqual([{ configId: 'agent', sessionId: 'session', value: '' }]);
});

test('allows only the bridge-reported current value outside a select picker', async () => {
  const bridgeCurrent: acp.SessionConfigOption = {
    currentValue: 'bridge-current',
    id: 'model',
    name: 'Model',
    options: [{ name: 'Picker value', value: 'picker-value' }],
    type: 'select',
  };
  const fixture = context([bridgeCurrent]);

  await applyAcpConfiguration(fixture.requester, session([bridgeCurrent]), {
    selections: { model: 'bridge-current' },
  });
  await expect(
    applyAcpConfiguration(fixture.requester, session([bridgeCurrent]), {
      selections: { model: 'saved-absent' },
    }),
  ).rejects.toMatchObject({ code: 'revo.agent.configuration_value_unsupported' });

  expect(fixture.requests).toEqual([
    { configId: 'model', sessionId: 'session', value: 'bridge-current' },
  ]);
});

test.each([
  [{ selections: { missing: 'one' } }, 'revo.agent.configuration_value_unsupported'],
  [{ selections: { model: false } }, 'revo.agent.configuration_value_unsupported'],
  [{ selections: { fast: 'yes' } }, 'revo.agent.configuration_value_unsupported'],
  [
    { catalogRevision: 'stale', selections: { model: 'missing' } },
    'revo.agent.configuration_stale',
  ],
] as const)(
  'rejects unavailable stable selections before a protocol request',
  async (value, code) => {
    const fixture = context();

    await expect(
      applyAcpConfiguration(fixture.requester, session([selectOption()]), value),
    ).rejects.toMatchObject({ code });
    expect(fixture.requests).toEqual([]);
  },
);

test('prefers decorated stable options and uses legacy ports only when stable options are absent', async () => {
  let legacyApplications = 0;
  const compatibility: AcpConfigurationCompatibility = {
    applyLegacy: async (_context, _sessionId, _options, _configId, value) => {
      legacyApplications += 1;
      return [selectOption(String(value))];
    },
    decorate: (options) => options.map((option) => ({ ...option, name: 'Decorated' })),
    legacyOptions: () => [selectOption()],
  };
  const stable = await applyAcpConfiguration(
    context().requester,
    session([selectOption()]),
    undefined,
    compatibility,
    { sessionId: 'session' },
  );
  const legacy = await applyAcpConfiguration(
    context().requester,
    session(),
    { selections: { model: 'two' } },
    compatibility,
    { sessionId: 'session' },
  );

  expect(stable.options[0]).toMatchObject({ name: 'Decorated' });
  expect(legacy.options[0]).toMatchObject({ currentValue: 'two' });
  expect(legacyApplications).toBe(1);
});

test('exposes the selection error as a stable typed error', () => {
  expect(new AcpConfigurationSelectionError('revo.agent.configuration_stale')).toMatchObject({
    code: 'revo.agent.configuration_stale',
    name: 'AcpConfigurationSelectionError',
  });
});

test('rejects a string value for a known boolean option', async () => {
  const fixture = context();
  const boolean = { currentValue: true, id: 'fast', name: 'Fast', type: 'boolean' as const };

  await expect(
    applyAcpConfiguration(fixture.requester, session([boolean]), { selections: { fast: 'yes' } }),
  ).rejects.toMatchObject({ code: 'revo.agent.configuration_value_unsupported' });
});

test('delegates provider-specific configuration requests through the ACP context', async () => {
  const client: Pick<acp.ClientContext, 'request'> = {
    request: async () => {
      throw new Error('fixture provider rejection');
    },
  };

  await expect(
    acpConfigurationRequester(client).request('session/set_model', {
      modelId: 'grok-4.6',
      sessionId: 'session',
    }),
  ).rejects.toThrow('fixture provider rejection');
});
