import type { AgentRef } from './agent-definition.js';
import type { AgentLaunchEvidence } from './launch.js';

export type AgentConfigurationSelectionValue = boolean | string;

export interface AgentConfigurationValue {
  readonly value: string;
  readonly name: string;
  readonly description?: string;
  readonly group?: { readonly id: string; readonly name: string };
}

interface AgentConfigurationOptionBase {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly category?: string;
}

export interface AgentConfigurationSelectOption extends AgentConfigurationOptionBase {
  readonly type: 'select';
  readonly currentValue: string;
  readonly values: readonly AgentConfigurationValue[];
}

export interface AgentConfigurationBooleanOption extends AgentConfigurationOptionBase {
  readonly type: 'boolean';
  readonly currentValue: boolean;
}

export type AgentConfigurationOption =
  | AgentConfigurationSelectOption
  | AgentConfigurationBooleanOption;

export interface AgentConfigurationProviderModels {
  readonly id: string;
  readonly name: string;
  readonly models: readonly AgentConfigurationValue[];
}

export interface AgentConfigurationModelView {
  readonly optionId: string;
  readonly currentModel: string;
  readonly currentProvider?: { readonly id: string; readonly name: string };
  readonly sessionAvailable: readonly AgentConfigurationValue[];
  readonly providers: readonly AgentConfigurationProviderModels[];
}

export interface AgentConfigurationCatalog {
  readonly schemaVersion: 'agent-configuration-catalog/v1';
  readonly agent: AgentRef;
  readonly definitionDigest: string;
  readonly launch: AgentLaunchEvidence;
  readonly catalogRevision: string;
  readonly options: readonly AgentConfigurationOption[];
  readonly model?: AgentConfigurationModelView;
}

export interface InspectAgentConfiguration {
  readonly agent: AgentRef;
  readonly workspace: { readonly directory: string };
}

export interface AgentConfigurationSelection {
  readonly catalogRevision?: string;
  readonly selections: Readonly<Record<string, AgentConfigurationSelectionValue>>;
}
