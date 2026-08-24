import { createHash } from 'node:crypto';
import { readFile, readlink, stat } from 'node:fs/promises';

import canonicalize from 'canonicalize';

import type {
  ProcessIdentity,
  ProcessIdentityInspectionResult,
} from '../../runtime/execution/index.js';

interface LinuxProcessFingerprintRecord {
  readonly schemaVersion: 'process-fingerprint/v1';
  readonly platform: 'linux';
  readonly pid: number;
  readonly processGroupId: number;
  readonly creationIdentity: string;
  readonly executablePath: string;
  readonly executableIdentity: string;
  readonly bootSessionIdentity: string;
}

const failedInspection = (
  reason: Extract<ProcessIdentityInspectionResult, { status: 'failed' }>['reason'],
): ProcessIdentityInspectionResult => Object.freeze({ status: 'failed', reason });

const positiveSafeInteger = (value: string | undefined): number | undefined => {
  if (value === undefined || !/^[1-9]\d*$/u.test(value)) return undefined;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return undefined;

  return parsed;
};

const linuxProcessFields = async (pid: number): Promise<readonly string[] | undefined> => {
  let statLine: string;
  try {
    statLine = await readFile(`/proc/${pid}/stat`, 'utf8');
  } catch {
    return undefined;
  }

  const commandEnd = statLine.lastIndexOf(')');
  if (commandEnd < 0) return undefined;

  return statLine
    .slice(commandEnd + 1)
    .trim()
    .split(/\s+/u);
};

const fingerprint = (record: LinuxProcessFingerprintRecord): string | undefined => {
  try {
    const canonical = canonicalize(record);
    if (canonical === undefined) return undefined;

    return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
  } catch {
    return undefined;
  }
};

export const inspectLinuxProcess = async (
  pid: number,
): Promise<ProcessIdentityInspectionResult> => {
  const fields = await linuxProcessFields(pid);
  if (fields === undefined) return failedInspection('inspection_failed');

  const processGroupId = positiveSafeInteger(fields[2]);
  if (processGroupId === undefined) return failedInspection('inspection_failed');

  const creationIdentity = fields[19];
  if (creationIdentity === undefined || !/^[1-9]\d*$/u.test(creationIdentity))
    return failedInspection('inspection_failed');

  let executablePath: string;
  try {
    executablePath = await readlink(`/proc/${pid}/exe`);
  } catch {
    return failedInspection('inspection_failed');
  }
  if (!executablePath.startsWith('/')) return failedInspection('inspection_failed');

  let executable: Awaited<ReturnType<typeof stat>>;
  try {
    executable = await stat(executablePath, { bigint: true });
  } catch {
    return failedInspection('inspection_failed');
  }

  let bootSessionIdentity: string;
  try {
    bootSessionIdentity = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
  } catch {
    return failedInspection('inspection_failed');
  }
  if (bootSessionIdentity.length === 0) return failedInspection('inspection_failed');

  if (processGroupId !== pid) return failedInspection('inspection_failed');

  const record: LinuxProcessFingerprintRecord = {
    schemaVersion: 'process-fingerprint/v1',
    platform: 'linux',
    pid,
    processGroupId,
    creationIdentity,
    executablePath,
    executableIdentity: `${executable.dev}:${executable.ino}`,
    bootSessionIdentity,
  };
  const processFingerprint = fingerprint(record);
  if (processFingerprint === undefined) return failedInspection('fingerprint_failed');

  const identity: ProcessIdentity = Object.freeze({
    pid,
    processGroupId,
    fingerprint: processFingerprint,
  });
  return Object.freeze({ status: 'identified', identity });
};
