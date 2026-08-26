import { link, open, rm, unlink, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';

import {
  getTerminalPublicationEventsCapability,
  type EventsAppendSink,
  type OutputAppendResult,
  RawFinalResponseEligibility,
  type RawResponsePublicationResult,
  type ScratchCleanupResult,
  type TerminalPublicationAuthority,
  type TerminalPublicationPort,
  type TerminalResultPublicationResult,
} from '../../runtime/execution/index.js';
import { InvocationBoundCarrier } from '../../runtime/execution/output-preparation-attempt/invocation-bound-carrier.js';
import { AGENT_MANAGER_LIMITS } from '../../runtime/policy/index.js';
import type { AgentEvent, AgentInvocationResult } from '../../runtime/spec/index.js';
import { nodePosixPathAdmission } from './node-posix-path-admission.js';

type Limits = Readonly<{
  maxTerminalEventBytes?: number;
}>;

type PublicationResult = TerminalResultPublicationResult | RawResponsePublicationResult;
type PublicationFailureStatus = Exclude<PublicationResult['status'], 'published'>;

const encoder = new TextEncoder();
const lineFeed = new Uint8Array([0x0a]);

const failedAppend = (reason: 'write_failed' | 'flush_failed'): OutputAppendResult =>
  Object.freeze({ status: 'failed', reason });

const encodeLine = (jsonBytes: Uint8Array): Uint8Array => {
  const line = new Uint8Array(jsonBytes.byteLength + 1);
  line.set(jsonBytes);
  line.set(lineFeed, jsonBytes.byteLength);
  return line;
};

const closeTmpBestEffort = async (handle: FileHandle | undefined): Promise<void> => {
  try {
    await handle?.close();
  } catch {
    // Best-effort close preserves the original publication failure bucket.
  }
};

const unlinkBestEffort = async (path: string): Promise<void> => {
  try {
    await unlink(path);
  } catch {
    // Manager-owned temporary cleanup failure does not change an already-published result.
  }
};

const flushDirectory = async (path: string): Promise<PublicationFailureStatus | undefined> => {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, 'r');
    await handle.sync();
    await handle.close();
    return undefined;
  } catch {
    await closeTmpBestEffort(handle);
    return 'directory_flush_failed';
  }
};

const hardlinkPublishFile = async (
  outputDirectory: string,
  finalName: 'result.json' | 'raw-final-response.txt',
  bytes: Uint8Array,
): Promise<PublicationResult> => {
  const finalPath = join(outputDirectory, finalName);
  const tmpPath = join(outputDirectory, `${finalName}.tmp`);
  let handle: FileHandle | undefined;
  try {
    handle = await open(tmpPath, 'wx', 0o600);
  } catch (error: unknown) {
    return Object.freeze({
      status: nodePosixPathAdmission.isExistingPathError(error) ? 'conflict' : 'write_failed',
    });
  }
  try {
    await handle.write(bytes);
  } catch {
    await closeTmpBestEffort(handle);
    return Object.freeze({ status: 'write_failed' });
  }
  try {
    await handle.sync();
    await handle.close();
  } catch {
    await closeTmpBestEffort(handle);
    return Object.freeze({ status: 'flush_failed' });
  }
  try {
    await link(tmpPath, finalPath);
  } catch (error: unknown) {
    return Object.freeze({
      status: nodePosixPathAdmission.isExistingPathError(error) ? 'conflict' : 'link_failed',
    });
  }
  const directoryFailure = await flushDirectory(outputDirectory);
  if (directoryFailure !== undefined) return Object.freeze({ status: directoryFailure });
  await unlinkBestEffort(tmpPath);
  return Object.freeze({ status: 'published', file: finalName });
};

export class NodePosixTerminalPublicationPort implements TerminalPublicationPort {
  readonly #maxTerminalEventBytes: number;

  constructor(limits: Limits = {}) {
    this.#maxTerminalEventBytes =
      limits.maxTerminalEventBytes ?? AGENT_MANAGER_LIMITS.maxTerminalEventBytes;
  }

  async appendLifecycleEvent(
    authority: TerminalPublicationAuthority,
    event: AgentEvent,
  ): Promise<OutputAppendResult> {
    const capability = this.#authenticate(authority);
    if (capability === undefined) return failedAppend('write_failed');
    const jsonBytes = encoder.encode(JSON.stringify(event));
    if (event.type === 'invocation.finished')
      return this.#appendTerminalEvent(capability.eventsAppendSink, jsonBytes);
    if (jsonBytes.byteLength > capability.maxEventBytes) return this.#suppressed();
    // AgentManager v1 §10 defines +2 as exactly two LF bytes: this line and the eventual terminal event.
    const reservation = this.#maxTerminalEventBytes + capability.maxEventBytes + 2;
    if (
      capability.usage.nonterminalBytesWritten + jsonBytes.byteLength + 1 >
      capability.maxEventsFileBytes - reservation
    )
      return this.#suppressed();
    const appended = await this.#writeAndFlush(capability.eventsAppendSink, jsonBytes);
    if (appended.status === 'appended')
      capability.usage.nonterminalBytesWritten += jsonBytes.byteLength + 1;
    return appended;
  }

  async publishTerminalResult(
    authority: TerminalPublicationAuthority,
    result: AgentInvocationResult,
  ): Promise<TerminalResultPublicationResult> {
    if (this.#authenticate(authority) === undefined)
      return Object.freeze({ status: 'write_failed' });
    const published = await hardlinkPublishFile(
      authority.outputDirectory,
      'result.json',
      encoder.encode(JSON.stringify(result)),
    );
    return published.status === 'published'
      ? Object.freeze({ status: 'published', file: 'result.json' })
      : published;
  }

  async publishRawResponse(
    authority: TerminalPublicationAuthority,
    eligibility: RawFinalResponseEligibility,
    bytes: Uint8Array,
  ): Promise<RawResponsePublicationResult> {
    const capability = this.#authenticate(authority);
    if (
      capability === undefined ||
      !RawFinalResponseEligibility.isBoundToToken(eligibility, capability.invocationToken)
    )
      return Object.freeze({ status: 'write_failed' });
    const published = await hardlinkPublishFile(
      authority.outputDirectory,
      'raw-final-response.txt',
      bytes,
    );
    return published.status === 'published'
      ? Object.freeze({ status: 'published', file: 'raw-final-response.txt' })
      : published;
  }

  async cleanupScratch(authority: TerminalPublicationAuthority): Promise<ScratchCleanupResult> {
    if (this.#authenticate(authority) === undefined)
      return Object.freeze({ status: 'failed', reason: 'cleanup_failed' });
    try {
      await rm(join(authority.outputDirectory, '.scratch'), { recursive: true });
      return Object.freeze({ status: 'cleaned' });
    } catch (error: unknown) {
      if (nodePosixPathAdmission.isMissingPathError(error))
        return Object.freeze({ status: 'absent' });
      return Object.freeze({ status: 'failed', reason: 'cleanup_failed' });
    }
  }

  #authenticate(authority: TerminalPublicationAuthority) {
    const capability = getTerminalPublicationEventsCapability(authority);
    if (capability === undefined) return undefined;
    if (!InvocationBoundCarrier.isBoundToToken(authority, capability.invocationToken))
      return undefined;
    return capability;
  }

  async #appendTerminalEvent(
    eventsAppendSink: EventsAppendSink,
    jsonBytes: Uint8Array,
  ): Promise<OutputAppendResult> {
    if (jsonBytes.byteLength > this.#maxTerminalEventBytes) return failedAppend('write_failed');
    return this.#writeAndFlush(eventsAppendSink, jsonBytes);
  }

  async #writeAndFlush(
    eventsAppendSink: EventsAppendSink,
    jsonBytes: Uint8Array,
  ): Promise<OutputAppendResult> {
    try {
      await eventsAppendSink.write(encodeLine(jsonBytes));
    } catch {
      return failedAppend('write_failed');
    }
    try {
      await eventsAppendSink.flush();
    } catch {
      return failedAppend('flush_failed');
    }
    return Object.freeze({ status: 'appended' });
  }

  #suppressed(): OutputAppendResult {
    return Object.freeze({ status: 'suppressed', reason: 'nonterminal_budget_exhausted' });
  }
}
