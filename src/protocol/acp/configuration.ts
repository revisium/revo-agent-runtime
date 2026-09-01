import type * as acp from '@agentclientprotocol/sdk';

import {
  normalizeAcpConfiguration,
  type NormalizedAcpConfiguration,
} from '../../configuration/catalog.js';
import type { AgentConfigurationSelection } from '../../contracts/configuration.js';
import type { AcpConfigurationCompatibility, AcpConfigurationRequester } from './compatibility.js';

export type AcpConfigurationFaultCode =
  | 'revo.agent.configuration_stale'
  | 'revo.agent.configuration_value_unsupported';

export class AcpConfigurationSelectionError extends Error {
  constructor(readonly code: AcpConfigurationFaultCode) {
    super('Agent configuration selection is unavailable.');
    this.name = 'AcpConfigurationSelectionError';
  }
}

export const acpClientCapabilities = (): acp.ClientCapabilities => ({
  session: { configOptions: { boolean: {} } },
});

export interface AcpConfigurationSession {
  readonly configOptions: readonly acp.SessionConfigOption[];
  readonly sessionId: string;
}

const selectable = (
  option: NormalizedAcpConfiguration['options'][number] | undefined,
  value: boolean | string,
): boolean => {
  if (option === undefined) return false;
  if (typeof value === 'boolean') return option.type === 'boolean';
  if (option.type !== 'select') return false;
  if (option.currentValue === value) return true;
  return option.values.some((candidate) => candidate.value === value);
};

const selectionError = (
  expectedRevision: string | undefined,
  actualRevision: string,
): AcpConfigurationSelectionError =>
  new AcpConfigurationSelectionError(
    expectedRevision !== undefined && expectedRevision !== actualRevision
      ? 'revo.agent.configuration_stale'
      : 'revo.agent.configuration_value_unsupported',
  );

interface SelectionState {
  readonly catalog: NormalizedAcpConfiguration;
  readonly options: readonly acp.SessionConfigOption[];
}

interface SelectionContext {
  readonly requester: AcpConfigurationRequester;
  readonly sessionId: string;
  readonly compatibility: AcpConfigurationCompatibility | undefined;
  readonly legacyCompatibility: AcpConfigurationCompatibility['applyLegacy'];
  readonly selection: AgentConfigurationSelection;
  readonly initialRevision: string;
}

const applyStableSelection = async (
  requester: AcpConfigurationRequester,
  sessionId: string,
  configId: string,
  value: boolean | string,
  compatibility: AcpConfigurationCompatibility | undefined,
): Promise<readonly acp.SessionConfigOption[]> => {
  const options = await requester.setOption({
    configId,
    sessionId,
    ...(typeof value === 'boolean' ? { type: 'boolean' as const, value } : { value }),
  });
  return compatibility?.decorate?.(options) ?? options;
};

const applySelections = async (
  context: SelectionContext,
  remaining: readonly [string, boolean | string][],
  state: SelectionState,
): Promise<NormalizedAcpConfiguration> => {
  const next = remaining[0];
  if (next === undefined) return state.catalog;
  const [configId, value] = next;
  const option = state.catalog.options.find((candidate) => candidate.id === configId);
  if (!selectable(option, value))
    throw selectionError(context.selection.catalogRevision, context.initialRevision);
  const options =
    context.legacyCompatibility === undefined
      ? await applyStableSelection(
          context.requester,
          context.sessionId,
          configId,
          value,
          context.compatibility,
        )
      : await context.legacyCompatibility(
          context.requester,
          context.sessionId,
          state.options,
          configId,
          value,
        );
  const catalog = normalizeAcpConfiguration(options);
  return applySelections(context, remaining.slice(1), { catalog, options });
};

export const applyAcpConfiguration = async (
  requester: AcpConfigurationRequester,
  session: AcpConfigurationSession,
  selection: AgentConfigurationSelection | undefined,
  compatibility?: AcpConfigurationCompatibility,
  rawSessionResponse?: Readonly<Record<string, unknown>>,
): Promise<NormalizedAcpConfiguration> => {
  const stableOptions = session.configOptions;
  const legacy =
    stableOptions.length === 0 &&
    compatibility?.legacyOptions !== undefined &&
    rawSessionResponse !== undefined
      ? compatibility.legacyOptions(rawSessionResponse)
      : [];
  const legacyCompatibility = legacy.length === 0 ? undefined : compatibility?.applyLegacy;
  const protocolOptions =
    stableOptions.length === 0
      ? legacy
      : (compatibility?.decorate?.(stableOptions) ?? stableOptions);
  const catalog = normalizeAcpConfiguration(protocolOptions);
  if (selection === undefined) return catalog;
  return applySelections(
    {
      requester,
      sessionId: session.sessionId,
      compatibility,
      legacyCompatibility,
      selection,
      initialRevision: catalog.catalogRevision,
    },
    Object.entries(selection.selections),
    { catalog, options: protocolOptions },
  );
};
