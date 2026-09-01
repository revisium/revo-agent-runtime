import type {
  ProtocolDriver,
  ProtocolPermissionDecision,
  ProtocolSession,
  ProtocolSessionRequest,
} from '../../../src/protocol/driver.js';

export type NativeProtocolScenario =
  | 'completed'
  | 'permission'
  | 'waiting-for-cancellation'
  | 'malformed'
  | 'open-failure'
  | 'missing-result'
  | 'empty-result'
  | 'duplicate-result'
  | 'schema-mismatch';

interface NativeProtocolInput {
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly permissions: Readonly<Record<string, unknown>>;
  readonly prompt: string;
  readonly resultSchema: Readonly<Record<string, unknown>>;
  readonly workspace: string;
}

export interface FakeNativeProtocolDriver {
  readonly driver: ProtocolDriver;
  readonly closeCalls: () => number;
  readonly cancelCalls: () => number;
  readonly input: () => NativeProtocolInput | undefined;
  readonly permissionDecision: () => ProtocolPermissionDecision | undefined;
  readonly wroteAfterClose: () => boolean;
}

const capturedInput = (request: ProtocolSessionRequest): NativeProtocolInput =>
  Object.freeze({
    parameters: request.parameters,
    permissions: request.permissions,
    prompt: request.prompt,
    resultSchema: request.resultSchema,
    workspace: request.workspace,
  });

const resultChunksFor = (scenario: NativeProtocolScenario): readonly string[] => {
  if (scenario === 'missing-result') return [];
  if (scenario === 'empty-result') return [''];
  if (scenario === 'duplicate-result') return ['{"answer":"first"}', '{"answer":"later"}'];
  if (scenario === 'schema-mismatch') return ['{"unexpected":"vendor-schema-payload"}'];
  return ['{"answer":"fake native result"}'];
};

export const fakeNativeProtocolDriver = (
  scenario: NativeProtocolScenario,
  options: { readonly cancelThrows?: boolean } = {},
): FakeNativeProtocolDriver => {
  let lastInput: NativeProtocolInput | undefined;
  let lastPermissionDecision: ProtocolPermissionDecision | undefined;
  let closeCalls = 0;
  let cancelCalls = 0;
  let closed = false;
  let wroteAfterClose = false;

  const driver: ProtocolDriver = {
    open: async (request): Promise<ProtocolSession> => {
      lastInput = capturedInput(request);
      request.observer.activity();
      if (scenario === 'open-failure')
        throw new Error(
          'native provider failure: contract-vendor-secret at /private/provider/path',
        );
      if (scenario === 'malformed')
        throw new Error('native provider emitted malformed contract-vendor-secret input');
      if (scenario === 'permission') {
        lastPermissionDecision = await request.observer.permission({
          options: [
            { id: 'allow-native', kind: 'allow_once' },
            { id: 'reject-native', kind: 'reject_once' },
          ],
        });
      }

      const completion = Promise.withResolvers<{ readonly status: 'completed' }>();
      if (scenario !== 'waiting-for-cancellation') {
        for (const chunk of resultChunksFor(scenario)) {
          if (closed) wroteAfterClose = true;
          else request.observer.resultChunk(new TextEncoder().encode(chunk));
        }
        completion.resolve({ status: 'completed' });
      }

      return Object.freeze({
        cancel: async (): Promise<void> => {
          cancelCalls += 1;
          if (options.cancelThrows === true) throw new Error('native provider cancellation failed');
        },
        close: async (): Promise<void> => {
          closeCalls += 1;
          closed = true;
        },
        completion: completion.promise,
      });
    },
  };

  return Object.freeze({
    cancelCalls: () => cancelCalls,
    closeCalls: () => closeCalls,
    driver,
    input: () => lastInput,
    permissionDecision: () => lastPermissionDecision,
    wroteAfterClose: () => wroteAfterClose,
  });
};
