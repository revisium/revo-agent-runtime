// @ts-check
/// <reference types="node" />
import { spawn } from 'node:child_process';
import { renameSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const captureIndex = args.indexOf('--capture');
const captureFile = captureIndex >= 0 ? args[captureIndex + 1] : undefined;
const command = args[0];
if (captureFile === undefined || command === undefined || captureIndex < 2)
  throw new Error('Usage: provider-diagnostics-wrapper <command> [args...] --capture <file>');

const commandArguments = args.slice(1, captureIndex);
const startedAt = new Date().toISOString();
const startedAtMs = Date.now();
const maxTraceBytes = 64 * 1024;
let traceBytes = 0;
let inputBuffer = '';
let outputBuffer = '';
const inboundState = { discarding: false, discardedBytes: 0 };
const outboundState = { discarding: false, discardedBytes: 0 };
const truncation = { inbound: false, outbound: false, stderr: false };
let droppedObservations = 0;
/** @type {unknown[]} */
const inbound = [];
/** @type {unknown[]} */
const outbound = [];
/** @type {string[]} */
const stderr = [];
let stderrBytes = 0;
let stderrPending = '';

/** @param {unknown} value */
const boundedText = (value) =>
  String(value)
    .replace(
      /\b(API[_-]?KEY|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|PASSWORD|SECRET)\s*[:=]\s*[^\s"']+/gi,
      '$1=[REDACTED]',
    )
    .replace(/(?:sk-ant-|sk-)[A-Za-z0-9_-]+/g, '[REDACTED_TOKEN]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .slice(0, 2_048);
/** @param {string} key */
const sensitiveKey = (key) =>
  /(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret|credential|private[_-]?key|token)/i.test(
    key,
  );
/** @param {unknown} value @param {number} [depth] @returns {unknown} */
const safeValue = (value, depth = 0) => {
  if (depth > 4) return '[depth-limited]';
  if (typeof value === 'string') return boundedText(value);
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (Array.isArray(value)) {
    /** @type {readonly unknown[]} */
    const entries = value;
    return entries.slice(0, 16).map((entry) => safeValue(entry, depth + 1));
  }
  if (typeof value !== 'object') return `[${typeof value}]`;
  return Object.fromEntries(
    Object.keys(value)
      .slice(0, 32)
      .map((key) => [
        boundedText(key),
        sensitiveKey(key) ? '[REDACTED]' : safeValue(Reflect.get(value, key), depth + 1),
      ]),
  );
};
/** @param {unknown[]} list @param {unknown} value */
const record = (list, value) => {
  if (traceBytes >= maxTraceBytes) {
    droppedObservations += 1;
    return;
  }
  const item = safeValue(value);
  const bytes = Buffer.byteLength(JSON.stringify(item) ?? '', 'utf8');
  if (traceBytes + bytes > maxTraceBytes) {
    droppedObservations += 1;
    return;
  }
  traceBytes += bytes;
  list.push(item);
};
/** @param {string} value @param {boolean} flush @returns {string} */
const redactStderrChunk = (value, flush) => {
  const combined = `${stderrPending}${value}`;
  if (flush) {
    stderrPending = '';
    return boundedText(combined);
  }
  const splitAt = Math.max(0, combined.length - 256);
  stderrPending = combined.slice(splitAt);
  return boundedText(combined.slice(0, splitAt));
};
/** @param {string} value */
const persistStderr = (value) => {
  if (!value) return;
  if (stderrBytes >= maxTraceBytes) {
    truncation.stderr = true;
    return;
  }
  const available = maxTraceBytes - stderrBytes;
  const bounded = Buffer.from(value, 'utf8').subarray(0, available).toString('utf8');
  stderr.push(bounded);
  stderrBytes += Buffer.byteLength(bounded, 'utf8');
  if (bounded.length < value.length) truncation.stderr = true;
};
/** @param {unknown} value @param {string} key @returns {unknown} */
const property = (value, key) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Reflect.get(value, key)
    : undefined;

/** @param {unknown} message @returns {Record<string, unknown>} */
const summary = (message) => {
  if (message === null || typeof message !== 'object') return { kind: typeof message };
  if (Array.isArray(message)) return { kind: 'array', length: message.length };
  /** @type {Record<string, unknown>} */
  const result = { jsonrpc: property(message, 'jsonrpc'), id: property(message, 'id') };
  const method = property(message, 'method');
  if (typeof method === 'string') result.method = method;
  const error = property(message, 'error');
  if (error !== undefined) result.error = safeValue(error);
  const resultValue = property(message, 'result');
  const stopReason = property(resultValue, 'stopReason');
  if (stopReason !== undefined)
    result.result = { stopReason, usage: property(resultValue, 'usage') };
  const update = property(property(message, 'params'), 'update');
  if (update !== undefined) {
    result.params = {
      update:
        update === null || typeof update !== 'object'
          ? { kind: typeof update }
          : {
              sessionUpdate: property(update, 'sessionUpdate'),
              status: property(update, 'status'),
              toolCallId: property(update, 'toolCallId') === undefined ? undefined : '[present]',
              error: safeValue(property(update, 'error')),
              rawOutput: property(update, 'rawOutput') === undefined ? undefined : '[present]',
            },
    };
  }
  return result;
};
/** @param {string} buffer @param {unknown[]} list @param {string} direction @param {{discarding:boolean, discardedBytes:number}} state */
const observeLines = (buffer, list, direction, state) => {
  let remaining = buffer;
  while (true) {
    if (state.discarding) {
      const newline = remaining.indexOf('\n');
      if (newline < 0) {
        state.discardedBytes += Buffer.byteLength(remaining, 'utf8');
        return '';
      }
      state.discardedBytes += Buffer.byteLength(remaining.slice(0, newline), 'utf8');
      record(list, { direction, kind: 'truncated', byteLength: state.discardedBytes });
      state.discarding = false;
      state.discardedBytes = 0;
      remaining = remaining.slice(newline + 1);
    }
    const newline = remaining.indexOf('\n');
    if (newline < 0) {
      if (Buffer.byteLength(remaining, 'utf8') > 32_768) {
        state.discarding = true;
        state.discardedBytes = Buffer.byteLength(remaining, 'utf8');
        if (direction === 'client_to_agent') truncation.inbound = true;
        else truncation.outbound = true;
        return '';
      }
      return remaining;
    }
    const line = remaining.slice(0, newline);
    remaining = remaining.slice(newline + 1);
    try {
      if (Buffer.byteLength(line, 'utf8') > 32_768) {
        record(list, { direction, kind: 'truncated', byteLength: Buffer.byteLength(line, 'utf8') });
        if (direction === 'client_to_agent') truncation.inbound = true;
        else truncation.outbound = true;
      } else record(list, { direction, ...summary(JSON.parse(line)) });
    } catch {
      const byteLength = Buffer.byteLength(line, 'utf8');
      record(
        list,
        byteLength > 16_384
          ? { direction, kind: 'truncated', byteLength }
          : { direction, kind: 'malformed', byteLength },
      );
      if (byteLength > 16_384) {
        if (direction === 'client_to_agent') truncation.inbound = true;
        else truncation.outbound = true;
      }
    }
  }
};
/** @param {string} buffer @param {unknown[]} list @param {string} direction @param {{discarding:boolean, discardedBytes:number}} state */
const observeFinal = (buffer, list, direction, state) => {
  if (state.discarding) {
    state.discardedBytes += Buffer.byteLength(buffer, 'utf8');
    record(list, { direction, kind: 'truncated', byteLength: state.discardedBytes });
    return;
  }
  if (!buffer) return;
  const byteLength = Buffer.byteLength(buffer, 'utf8');
  if (byteLength > 32_768) {
    record(list, { direction, kind: 'truncated', byteLength });
    if (direction === 'client_to_agent') truncation.inbound = true;
    else truncation.outbound = true;
    return;
  }
  try {
    record(list, { direction, ...summary(JSON.parse(buffer)) });
  } catch {
    record(
      list,
      byteLength > 16_384
        ? { direction, kind: 'truncated', byteLength }
        : { direction, kind: 'malformed', byteLength },
    );
    if (byteLength > 16_384) {
      if (direction === 'client_to_agent') truncation.inbound = true;
      else truncation.outbound = true;
    }
  }
};
/** @param {{code: number|null, signal: string|null}} childExit @param {{code: number|null, signal: string|null}} wrapperExit */
const writeCapture = (childExit, wrapperExit) => {
  const capture = {
    schemaVersion: 'provider-diagnostic-transport/v1',
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAtMs,
    inbound,
    outbound,
    stderr,
    truncation: { ...truncation, droppedObservations },
    child: childExit,
    wrapper: wrapperExit,
  };
  const temporary = `${captureFile}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(capture)}\n`, 'utf8');
  renameSync(temporary, captureFile);
};

const child = spawn(command, commandArguments, {
  cwd: process.cwd(),
  env: process.env,
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});
process.stdin.on('data', (chunk) => {
  const bytes = Buffer.from(chunk);
  inputBuffer = `${inputBuffer}${bytes.toString('utf8')}`;
  inputBuffer = observeLines(inputBuffer, inbound, 'client_to_agent', inboundState);
  if (!child.stdin.destroyed) child.stdin.write(bytes);
});
process.stdin.on('end', () => child.stdin.end());
child.stdout.on('data', (chunk) => {
  const bytes = Buffer.from(chunk);
  outputBuffer = `${outputBuffer}${bytes.toString('utf8')}`;
  outputBuffer = observeLines(outputBuffer, outbound, 'agent_to_client', outboundState);
  process.stdout.write(bytes);
});
child.stderr.on('data', (chunk) => {
  const bytes = Buffer.from(chunk);
  stderrPending += bytes.toString('utf8');
  if (Buffer.byteLength(stderrPending, 'utf8') > maxTraceBytes) {
    stderrPending = Buffer.from(stderrPending, 'utf8').subarray(-maxTraceBytes).toString('utf8');
    truncation.stderr = true;
  }
});
child.on('error', (error) => record(outbound, { kind: 'spawn_error', message: error.message }));
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGHUP', () => child.kill('SIGHUP'));
child.on('exit', (code, signal) => {
  observeFinal(inputBuffer, inbound, 'client_to_agent', inboundState);
  observeFinal(outputBuffer, outbound, 'agent_to_client', outboundState);
  if (Buffer.byteLength(stderrPending, 'utf8') > 2_048) truncation.stderr = true;
  const finalStderr = redactStderrChunk('', true);
  persistStderr(finalStderr);
  if (finalStderr) process.stderr.write(finalStderr);
  const childExit = { code, signal };
  writeCapture(childExit, { code: code ?? 1, signal: null });
  process.exit(code ?? 1);
});
