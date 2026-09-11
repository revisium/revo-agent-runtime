import type {
  AgentConfigurationCatalog,
  AgentConfigurationModelView,
  AgentConfigurationOption,
} from '../contracts/configuration.js';

const modelOption = (
  catalog: AgentConfigurationCatalog,
): Extract<AgentConfigurationOption, { readonly type: 'select' }> | undefined => {
  const option = catalog.options.find(
    (candidate) => candidate.type === 'select' && candidate.id === catalog.model?.optionId,
  );
  return option?.type === 'select' ? option : undefined;
};

const selectableModelValues = (
  catalog: AgentConfigurationCatalog,
  model: AgentConfigurationModelView,
): Set<string> => {
  const optionValues = new Set(modelOption(catalog)?.values.map(({ value }) => value));
  const sessionValues = new Set(model.sessionAvailable.map(({ value }) => value));
  const connectedValues = new Set(
    model.providers
      .filter(({ connected }) => connected)
      .flatMap(({ models }) =>
        models.filter(({ connected }) => connected).map(({ value }) => value),
      ),
  );

  return new Set(
    [...connectedValues].filter((value) => optionValues.has(value) && sessionValues.has(value)),
  );
};

const projectModel = (
  model: AgentConfigurationModelView,
  selectableValues: Set<string>,
  currentModel: string,
): AgentConfigurationModelView | undefined => {
  const providers = model.providers
    .filter(({ connected }) => connected)
    .map((provider) =>
      Object.freeze({
        ...provider,
        models: Object.freeze(
          provider.models.filter(
            ({ connected, value }) => connected && selectableValues.has(value),
          ),
        ),
      }),
    )
    .filter(({ models }) => models.length > 0);
  const currentProvider = providers.find(({ models }) =>
    models.some(({ value }) => value === currentModel),
  );
  if (currentProvider === undefined) return undefined;

  return Object.freeze({
    ...model,
    currentModel,
    currentProvider: Object.freeze({ id: currentProvider.id, name: currentProvider.name }),
    providers: Object.freeze(providers),
    sessionAvailable: Object.freeze(
      model.sessionAvailable.filter(({ value }) => selectableValues.has(value)),
    ),
  });
};

const projectOptions = (
  catalog: AgentConfigurationCatalog,
  selectableValues: Set<string>,
  currentModel: string,
): AgentConfigurationCatalog['options'] =>
  Object.freeze(
    catalog.options.map((option) =>
      option.type !== 'select' || option.id !== catalog.model?.optionId
        ? option
        : Object.freeze({
            ...option,
            currentValue: currentModel,
            values: Object.freeze(option.values.filter(({ value }) => selectableValues.has(value))),
          }),
    ),
  );

/**
 * Projects a catalog to models selectable from the inspected catalog. Returns
 * undefined when a provider-backed catalog has no model satisfying the
 * provider, option, and session evidence.
 */
export const projectSelectableAgentConfiguration = (
  catalog: AgentConfigurationCatalog,
): AgentConfigurationCatalog | undefined => {
  const model = catalog.model;
  if (model === undefined || model.providers.length === 0) return catalog;

  const selectableValues = selectableModelValues(catalog, model);
  const currentModel = selectableValues.has(model.currentModel)
    ? model.currentModel
    : ([...selectableValues][0] ?? model.currentModel);
  const projectedModel = projectModel(model, selectableValues, currentModel);
  if (projectedModel === undefined) return undefined;
  return Object.freeze({
    ...catalog,
    model: projectedModel,
    options: projectOptions(catalog, selectableValues, projectedModel.currentModel),
  });
};
