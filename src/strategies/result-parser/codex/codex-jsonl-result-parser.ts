import type { JsonObject } from '../../../runtime/spec/index.js';

interface CodexUsage {
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens?: number;
}

interface CodexParsedResult {
  readonly response: JsonObject;
  readonly usage?: CodexUsage;
}

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isJsonObject = (value: unknown): value is JsonObject => isRecord(value);

const copyUsage = (value: unknown): CodexUsage | undefined => {
  if (!isRecord(value)) return undefined;
  const number = (key: string): number | undefined =>
    typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && value[key] >= 0
      ? value[key]
      : undefined;
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

export class CodexJsonlResultParser {
  private carry = new Uint8Array(0);
  private terminal = false;
  private failed: Error | undefined;
  private response: JsonObject | undefined;
  private usage: CodexUsage | undefined;

  write(chunk: Uint8Array): void {
    if (this.failed !== undefined) throw this.failed;
    if (this.terminal) return this.fail('Codex JSONL frame appeared after turn.completed.');
    const combined = new Uint8Array(this.carry.byteLength + chunk.byteLength);
    combined.set(this.carry);
    combined.set(chunk, this.carry.byteLength);
    let start = 0;
    for (let index = 0; index < combined.byteLength; index += 1) {
      if (combined[index] !== 10) continue;
      const line = combined.slice(start, index);
      start = index + 1;
      this.readLine(line[line.byteLength - 1] === 13 ? line.slice(0, -1) : line);
      if (this.failed !== undefined) throw this.failed;
    }
    this.carry = combined.slice(start);
    if (this.carry.byteLength > 1_048_576) this.fail('Codex JSONL carry exceeded its bound.');
  }

  end(): CodexParsedResult {
    if (this.failed !== undefined) throw this.failed;
    if (this.carry.byteLength > 0) this.readLine(this.carry);
    if (this.failed !== undefined) throw this.failed;
    if (!this.terminal || this.response === undefined)
      throw new Error('Codex JSONL stream has no completed agent response.');
    return Object.freeze({
      response: this.response,
      ...(this.usage === undefined ? {} : { usage: this.usage }),
    });
  }

  observeProcessExit(exitCode: number | null, signal: NodeJS.Signals | null): void {
    if (exitCode !== 0 || signal !== null)
      this.fail('Codex process failed after protocol completion.');
  }

  private readLine(line: Uint8Array): void {
    if (line.byteLength === 0) return;
    let frame: unknown;
    try {
      frame = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
    } catch {
      this.fail('Codex JSONL frame is not valid UTF-8 JSON.');
      return;
    }
    if (!isRecord(frame) || typeof frame.type !== 'string') {
      this.fail('Codex JSONL frame is not a top-level object with a type.');
      return;
    }
    switch (frame.type) {
      case 'thread.started':
      case 'turn.started':
      case 'item.started':
        return;
      case 'item.completed': {
        const item = frame.item;
        if (!isRecord(item) || item.type !== 'agent_message' || typeof item.text !== 'string')
          return;
        let value: unknown;
        try {
          value = JSON.parse(item.text);
        } catch {
          this.fail('Codex final agent message is not valid JSON.');
          return;
        }
        if (!isJsonObject(value)) this.fail('Codex final agent message is not a JSON object.');
        else this.response = Object.freeze(value);
        return;
      }
      case 'turn.completed':
        if (this.terminal) this.fail('Codex JSONL stream contains duplicate completion.');
        else {
          this.terminal = true;
          this.usage = copyUsage(frame.usage);
        }
        return;
      case 'error':
        this.fail('Codex JSONL stream reported an error.');
        return;
      default:
        this.fail(`Unknown Codex JSONL event: ${frame.type}`);
    }
  }

  private fail(message: string): never {
    this.failed ??= new Error(message);
    throw this.failed;
  }
}
