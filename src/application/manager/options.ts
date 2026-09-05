import { AgentManagerError, type ActiveInvocationStateSink } from '../../contracts/manager.js';
import type { AgentSessionEventSink } from '../../contracts/session/events/sink.js';
import type { ActiveAgentSessionStateSink } from '../../contracts/session/persistence/active-state.js';
import {
  createSealedAgentRegistry,
  DefinitionValidationError,
  DuplicateAgentDefinitionError,
} from '../../definition/index.js';
import { fault } from '../faults/agent-faults.js';
import type { NormalizedAgentSessionManagerOptions } from '../session/management/composition.js';
import { resolveAgentSessionManagerLimits } from '../session/policy/limits/resolve.js';
import { LimitValidationError, managerLimits } from './limits.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isActiveStateSink = (value: unknown): value is ActiveInvocationStateSink =>
  isRecord(value) && typeof value.save === 'function' && typeof value.remove === 'function';

const isActiveSessionStateSink = (value: unknown): value is ActiveAgentSessionStateSink =>
  isRecord(value) && typeof value.save === 'function' && typeof value.remove === 'function';

const isSessionEventSink = (value: unknown): value is AgentSessionEventSink =>
  isRecord(value) && typeof value.append === 'function';

const sessionOptions = (value: unknown): NormalizedAgentSessionManagerOptions | undefined => {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    Reflect.ownKeys(value).some(
      (key) => key !== 'activeStateSink' && key !== 'eventSink' && key !== 'limits',
    ) ||
    !isActiveSessionStateSink(value.activeStateSink) ||
    !isSessionEventSink(value.eventSink)
  )
    throw new TypeError('Invalid session manager options.');
  const limits = resolveAgentSessionManagerLimits(value.limits);
  return Object.freeze({
    activeStateSink: value.activeStateSink,
    eventSink: value.eventSink,
    limits,
  });
};

const isNonEmptyStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) &&
  value.every((item: unknown) => typeof item === 'string' && item.length > 0);

const constructionError = (error: unknown): AgentManagerError => {
  if (error instanceof AgentManagerError && error.fault.code === 'revo.agent.limit_invalid')
    return new AgentManagerError(
      fault('revo.agent.limit_invalid', 'Agent manager limit is invalid.', 'construction'),
    );
  if (error instanceof DuplicateAgentDefinitionError)
    return new AgentManagerError(
      fault(
        'revo.agent.definition_duplicate',
        'Agent definition reference is duplicated.',
        'construction',
      ),
    );
  if (error instanceof DefinitionValidationError)
    return new AgentManagerError(
      fault(
        error.code === 'strategy_unsupported'
          ? 'revo.agent.strategy_unsupported'
          : 'revo.agent.definition_invalid',
        error.code === 'strategy_unsupported'
          ? 'Agent strategy is unsupported.'
          : 'Agent definition is invalid.',
        'construction',
      ),
    );
  if (error instanceof LimitValidationError)
    return new AgentManagerError(
      fault('revo.agent.limit_invalid', 'Agent manager limit is invalid.', 'construction'),
    );
  return new AgentManagerError(
    fault('revo.agent.definition_invalid', 'Agent definition is invalid.', 'construction'),
  );
};

const redactionSecrets = (value: unknown): readonly string[] => {
  if (
    !isRecord(value) ||
    Reflect.ownKeys(value).some((key) => key !== 'secrets') ||
    !isNonEmptyStringArray(value.secrets) ||
    value.secrets.length > 1_000 ||
    value.secrets.reduce(
      (total, secret) => total + new TextEncoder().encode(secret).byteLength,
      0,
    ) > 65_536
  )
    throw new TypeError('Invalid redaction secrets.');
  return Object.freeze([...value.secrets]);
};

export const validateManagerOptions = (options: unknown) => {
  try {
    if (
      !isRecord(options) ||
      Reflect.ownKeys(options).some(
        (key) =>
          key !== 'activeStateSink' &&
          key !== 'definitions' &&
          key !== 'limits' &&
          key !== 'redaction' &&
          key !== 'sessions',
      ) ||
      !Array.isArray(options.definitions) ||
      !isActiveStateSink(options.activeStateSink)
    )
      throw new TypeError('Invalid manager options.');
    return Object.freeze({
      activeStateSink: options.activeStateSink,
      definitions: createSealedAgentRegistry(options.definitions),
      limits: managerLimits(options.limits),
      redaction: Object.freeze({
        secrets: redactionSecrets(options.redaction ?? { secrets: [] }),
      }),
      sessions: sessionOptions(options.sessions),
    });
  } catch (error) {
    throw constructionError(error);
  }
};
