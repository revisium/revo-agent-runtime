import { join } from 'node:path';

import type { AgentEvent, AgentInvocationResult } from '../../../src/contracts/manager.js';
import { prepareOutputClaim } from '../../../src/execution/output/claim.js';
import { createNodeOutputClaimPlatform } from '../../../src/platform/node/output/claim.js';

const event: AgentEvent = Object.freeze({
  invocationId: 'invocation',
  pin: { agentId: 'codex', agentVersion: '1.0.0', definitionDigest: 'digest' },
  schemaVersion: 'agent-event/v1',
  sequence: 1,
  timestamp: '2026-08-30T00:00:00.000Z',
  type: 'invocation.finished',
});

export const successfulOutputResult = (directory: string, raw = false): AgentInvocationResult =>
  Object.freeze({
    files: {
      directory,
      events: 'events.ndjson' as const,
      result: 'result.json' as const,
      stderr: 'stderr.log' as const,
      stdout: 'stdout.log' as const,
      ...(raw ? { rawFinalResponse: 'raw-final-response.txt' as const } : {}),
    },
    invocationId: 'invocation',
    acceptedAt: '2026-08-30T00:00:00.000Z',
    durationMs: 0,
    exit: { code: 0, signal: null },
    finishedAt: '2026-08-30T00:00:00.000Z',
    launch: { executable: '/usr/bin/node', reportedVersion: '24.18.0' },
    pin: event.pin,
    schemaVersion: 'agent-invocation-result/v1' as const,
    status: 'succeeded' as const,
    value: {},
  });

export const claimOutputAt = async (workspace: string, outputDirectory: string) => {
  const prepared = await prepareOutputClaim(createNodeOutputClaimPlatform(), {
    outputDirectory,
    workspace,
  });
  if (prepared.status !== 'prepared') throw new Error('Expected output preparation.');
  const claimed = await prepared.output.claim();
  if (claimed.status !== 'claimed') throw new Error('Expected output claim.');
  return claimed.output;
};

export const claimOutput = (directory: string) =>
  claimOutputAt(directory, join(directory, 'output'));

export const outputPublication = (directory: string, rawResponse?: Uint8Array) => ({
  events: [event],
  maxEventBytes: 1_024,
  maxEventsFileBytes: 4_096,
  ...(rawResponse === undefined ? {} : { rawResponse }),
  result: successfulOutputResult(directory, rawResponse !== undefined),
  stderr: new TextEncoder().encode('stderr'),
  stdout: new TextEncoder().encode('stdout'),
});

export const failedResultWithoutFile = (directory: string): AgentInvocationResult =>
  Object.freeze({
    error: {
      code: 'revo.agent.output_write_failed' as const,
      message: 'Output write failed.',
      phase: 'finalizing' as const,
      retryable: false,
    },
    files: {
      directory,
      events: 'events.ndjson' as const,
      stderr: 'stderr.log' as const,
      stdout: 'stdout.log' as const,
    },
    invocationId: 'invocation',
    acceptedAt: '2026-08-30T00:00:00.000Z',
    durationMs: 0,
    exit: { code: 1, signal: null },
    finishedAt: '2026-08-30T00:00:00.000Z',
    launch: { executable: '/usr/bin/node', reportedVersion: '24.18.0' },
    pin: event.pin,
    schemaVersion: 'agent-invocation-result/v1',
    status: 'failed',
  });
