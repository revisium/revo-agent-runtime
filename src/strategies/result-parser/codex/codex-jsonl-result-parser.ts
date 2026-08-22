import { freezeJsonValue } from '../../../runtime/execution/freeze-json-value.js';
import type {
  ParserFailureReason,
  ResultParserEndResult,
  ResultParserId,
  ResultParserPort,
  ResultParserUsage,
  ResultParserWriteResult,
  RawResponseCapture,
  BoundedRawResponseEvidence,
} from '../../../runtime/execution/index.js';
import type { JsonObject } from '../../../runtime/spec/index.js';

type JsonRecord = Readonly<Record<string, unknown>>;

const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();
const observed = Object.freeze({ status: 'observed' } satisfies ResultParserWriteResult);

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isJsonObject = (value: unknown): value is JsonObject => isRecord(value);

const isFrameRecord = (value: unknown): value is JsonRecord & { readonly type: string } =>
  isRecord(value) && typeof value.type === 'string';

const copyUsage = (value: unknown): ResultParserUsage | undefined => {
  if (!isRecord(value)) return undefined;
  const number = (key: string): number | undefined => {
    const candidate = value[key];
    return typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0
      ? candidate
      : undefined;
  };
  const inputTokens = number('input_tokens');
  const cachedInputTokens = number('cached_input_tokens');
  const outputTokens = number('output_tokens');
  if (inputTokens === undefined && cachedInputTokens === undefined && outputTokens === undefined)
    return undefined;
  return Object.freeze({
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
  });
};

export class CodexJsonlResultParser implements ResultParserPort {
  readonly id: ResultParserId = 'codex-jsonl/v1';

  private carry = new Uint8Array(0);
  private terminal = false;
  private failed: ParserFailureReason | undefined;
  private response: JsonObject | undefined;
  private usage: ResultParserUsage | undefined;
  private raw: BoundedRawResponseEvidence | undefined;

  constructor(
    private readonly maxRawResponseBytes: number,
    private readonly rawResponseCapture?: RawResponseCapture,
  ) {}

  writeProtocolBytes(bytes: Uint8Array): ResultParserWriteResult {
    if (this.failed !== undefined) return this.writeFailure();
    const combined = new Uint8Array(this.carry.byteLength + bytes.byteLength);
    combined.set(this.carry);
    combined.set(bytes, this.carry.byteLength);

    let start = 0;
    for (let index = 0; index < combined.byteLength; index += 1) {
      if (combined[index] !== 10) continue;
      const line = combined.slice(start, index);
      start = index + 1;
      const result = this.readLine(line[line.byteLength - 1] === 13 ? line.slice(0, -1) : line);
      if (result.status === 'failed') return result;
    }

    this.carry = combined.slice(start);
    // Narrow exception: no dedicated frame-byte bound exists yet for stdout-delivery result parsers (the spec's 1 MiB/10k-frame/64-pending-write policy at execution-handoff.spec.md §11 is scoped to protocol-delivery drivers). Reusing maxRawResponseBytes here is this slice's deliberate simplification — owner: this slice; revisit if a dedicated stdout-parser frame bound is introduced.
    if (this.carry.byteLength > this.maxRawResponseBytes) return this.fail('frame_overflow');
    return observed;
  }

  endProtocolBytes(): ResultParserEndResult {
    if (this.failed !== undefined) return this.endFailure();
    if (this.carry.byteLength > 0) {
      const result = this.readLine(this.carry);
      this.carry = new Uint8Array(0);
      if (result.status === 'failed') return result;
    }
    if (!this.terminal || this.response === undefined) return this.failEnd('missing_terminal');
    return Object.freeze({
      status: 'completed',
      response: this.response,
      ...(this.usage === undefined ? {} : { usage: this.usage }),
    });
  }

  dispose(): void {
    // Redaction material and registered secrets use zero-fill hygiene; parser input is already post-redaction.
    this.carry = new Uint8Array(0);
    this.rawResponseCapture?.dispose();
  }

  private readLine(line: Uint8Array): ResultParserWriteResult {
    if (line.byteLength === 0) return observed;
    this.rawResponseCapture?.record(line);
    const frame = this.parseFrame(line);
    if (frame.status === 'failed') return this.fail(frame.reason);
    if (this.terminal)
      return this.fail(
        frame.value.type === 'turn.completed' ? 'duplicate_terminal' : 'frame_malformed',
      );
    return this.observeFrame(frame.value);
  }

  private parseFrame(line: Uint8Array):
    | Readonly<{ status: 'parsed'; value: JsonRecord & { readonly type: string } }>
    | Readonly<{
        status: 'failed';
        reason: ParserFailureReason;
      }> {
    if (line.byteLength > this.maxRawResponseBytes) {
      const oversizedPayload = this.tryReadOversizedTerminalPayload(line);
      return Object.freeze({
        status: 'failed',
        reason: oversizedPayload ? 'response_too_large' : 'frame_overflow',
      });
    }

    let text: string;
    try {
      text = decoder.decode(line);
    } catch {
      return Object.freeze({ status: 'failed', reason: 'invalid_utf8' });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return Object.freeze({ status: 'failed', reason: 'invalid_json' });
    }

    if (!isFrameRecord(parsed))
      return Object.freeze({ status: 'failed', reason: 'frame_malformed' });
    return Object.freeze({ status: 'parsed', value: parsed });
  }

  private tryReadOversizedTerminalPayload(line: Uint8Array): boolean {
    this.rawResponseCapture?.record(line);
    try {
      const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
      if (!isRecord(parsed) || parsed.type !== 'item.completed') return false;
      const item = parsed.item;
      return (
        isRecord(item) &&
        item.type === 'agent_message' &&
        typeof item.text === 'string' &&
        encoder.encode(item.text).byteLength > this.maxRawResponseBytes
      );
    } catch {
      return false;
    }
  }

  private observeFrame(frame: JsonRecord & { readonly type: string }): ResultParserWriteResult {
    switch (frame.type) {
      case 'thread.started':
      case 'turn.started':
      case 'item.started':
        return observed;
      case 'item.completed':
        return this.observeCompletedItem(frame.item);
      case 'turn.completed':
        this.terminal = true;
        this.usage = copyUsage(frame.usage);
        return observed;
      case 'error':
        return observed;
      default:
        return observed;
    }
  }

  private observeCompletedItem(item: unknown): ResultParserWriteResult {
    if (!isRecord(item) || item.type !== 'agent_message' || typeof item.text !== 'string')
      return observed;
    if (item.text === '') return this.fail('response_empty');
    if (encoder.encode(item.text).byteLength > this.maxRawResponseBytes)
      return this.fail('response_too_large');

    let value: unknown;
    try {
      value = JSON.parse(item.text);
    } catch {
      return this.fail('invalid_json');
    }
    if (!isJsonObject(value)) return this.fail('response_not_object');
    freezeJsonValue(value);
    this.response = value;
    return observed;
  }

  private fail(reason: ParserFailureReason): ResultParserWriteResult {
    this.failed = reason;
    return this.writeFailure();
  }

  private failEnd(reason: ParserFailureReason): ResultParserEndResult {
    this.failed = reason;
    return this.endFailure();
  }

  private takeRaw(): BoundedRawResponseEvidence | undefined {
    this.raw ??= this.rawResponseCapture?.take();
    return this.raw;
  }

  private writeFailure(): ResultParserWriteResult {
    const raw = this.takeRaw();
    return Object.freeze({
      status: 'failed',
      reason: this.failed ?? 'frame_malformed',
      ...(raw === undefined ? {} : { raw }),
    });
  }

  private endFailure(): ResultParserEndResult {
    const raw = this.takeRaw();
    return Object.freeze({
      status: 'failed',
      reason: this.failed ?? 'frame_malformed',
      ...(raw === undefined ? {} : { raw }),
    });
  }
}
