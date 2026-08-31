import type { AgentUsage } from '../../contracts/manager.js';
import type {
  ProtocolObserver,
  ProtocolOutcome,
  ProtocolPermissionDecision,
} from '../../protocol/driver.js';
import { normalizeResult } from '../result/normalizer.js';
import { createRawResponseCapture } from '../result/raw-response.js';
import type { ExecutionOutcome } from './terminal.js';

export interface ProtocolObservation {
  readonly observer: ProtocolObserver;
  result(outcome: ProtocolOutcome): ExecutionOutcome;
}

type ProtocolObservationOptions = {
  readonly maxRawResponseBytes: number;
  readonly resultSchema: Readonly<Record<string, unknown>>;
  readonly secrets: readonly string[];
  readonly usage: boolean;
};

const defaultProtocolObservationOptions = Object.freeze({
  maxRawResponseBytes: 1_048_576,
  resultSchema: {},
  secrets: [],
  usage: false,
});

export const observeProtocol = (
  activity: () => void,
  options: ProtocolObservationOptions = defaultProtocolObservationOptions,
): ProtocolObservation => {
  let usage: AgentUsage | undefined;
  const capture = createRawResponseCapture({
    maxBytes: options.maxRawResponseBytes,
    previewBytes: 1_024,
    secrets: options.secrets,
  });
  return {
    observer: {
      activity,
      permission: async (request): Promise<ProtocolPermissionDecision> => {
        const rejection = request.options.find(
          (option) => option.kind === 'reject_once' || option.kind === 'reject_always',
        );
        return rejection === undefined
          ? { outcome: 'denied' }
          : { optionId: rejection.id, outcome: 'selected' };
      },
      resultChunk: (chunk) => capture.record(chunk),
      usage: (value) => {
        if (options.usage) usage = Object.freeze({ ...value });
      },
    },
    result: (protocolOutcome): ExecutionOutcome => {
      if (protocolOutcome.status === 'failed')
        return {
          status: 'failed',
          ...(protocolOutcome.code === undefined ? {} : { code: protocolOutcome.code }),
        };
      const evidence = capture.take();
      const normalized = normalizeResult({
        evidence,
        schema: options.resultSchema,
      });
      const terminalOutcome: ExecutionOutcome =
        normalized.status === 'succeeded'
          ? { status: 'succeeded', value: normalized.value }
          : {
              status: 'failed',
              code: normalized.code,
              reason: normalized.reason,
              evidence,
            };
      return Object.freeze({
        ...terminalOutcome,
        ...(usage === undefined ? {} : { usage }),
      });
    },
  };
};
