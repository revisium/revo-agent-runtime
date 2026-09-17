import { readFile } from 'node:fs/promises';

export type AcpFrame = Readonly<Record<string, unknown>>;

export interface FakeAcpTrace {
  readonly closeReceived: boolean;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly exited: boolean;
  readonly inbound: readonly AcpFrame[];
  readonly outbound: readonly AcpFrame[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const isFrames = (value: unknown): value is readonly AcpFrame[] =>
  Array.isArray(value) && value.every(isRecord);

export const readFakeAcpTrace = async (path: string): Promise<FakeAcpTrace> => {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (
    !isRecord(value) ||
    !isFrames(value.inbound) ||
    !isFrames(value.outbound) ||
    !isRecord(value.environment) ||
    typeof value.closeReceived !== 'boolean' ||
    typeof value.exited !== 'boolean'
  )
    throw new TypeError('Invalid fake ACP wire trace.');
  return {
    closeReceived: value.closeReceived,
    environment: Object.fromEntries(
      Object.entries(value.environment).map(([name, variable]) => [
        name,
        typeof variable === 'string' ? variable : undefined,
      ]),
    ),
    exited: value.exited,
    inbound: value.inbound,
    outbound: value.outbound,
  };
};

export const inboundFrames = (trace: FakeAcpTrace, method: string): readonly AcpFrame[] =>
  trace.inbound.filter((frame) => frame.method === method);

export const inboundParams = (trace: FakeAcpTrace, method: string): unknown =>
  inboundFrames(trace, method)[0]?.params;

export const promptTexts = (trace: FakeAcpTrace): readonly string[] =>
  inboundFrames(trace, 'session/prompt').map((frame) => {
    const params = frame.params;
    if (!isRecord(params) || !Array.isArray(params.prompt)) throw new TypeError('Missing prompt.');
    return params.prompt
      .filter((block: unknown) => isRecord(block) && block.type === 'text')
      .map((block: unknown) => (isRecord(block) ? String(block.text) : ''))
      .join('');
  });
