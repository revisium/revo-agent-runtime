import { link, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { encodeBoundedEvents } from '../../../execution/output/bounded-events.js';
import { beginOutputPublication } from '../../../execution/output/claim.js';
import type {
  ClaimedInvocationOutputPublisher,
  ClaimedOutputPublication,
  ClaimedOutputPublicationResult,
} from '../../../execution/output/publication.js';

const encoder = new TextEncoder();

interface ClosableOutputHandle {
  close(): Promise<void>;
}

interface OutputFileHandle extends ClosableOutputHandle {
  writeFile(data: Uint8Array): Promise<void>;
  sync(): Promise<void>;
}

interface OutputDirectoryHandle extends ClosableOutputHandle {
  sync(): Promise<void>;
}

export interface NodeOutputPublicationSystem {
  open(path: string, flags: 'wx', mode: number): Promise<OutputFileHandle>;
  openDirectory(path: string): Promise<OutputDirectoryHandle>;
  link(existingPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export const nodeOutputPublicationSystem: NodeOutputPublicationSystem = Object.freeze({
  link,
  open: async (path: string, flags: 'wx', mode: number): Promise<OutputFileHandle> =>
    open(path, flags, mode),
  openDirectory: async (path: string): Promise<OutputDirectoryHandle> => open(path, 'r'),
  unlink,
});

const existingPath = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';

const closeQuietly = async (handle: ClosableOutputHandle | undefined): Promise<void> => {
  try {
    await handle?.close();
  } catch {
    // The caller retains the original write or flush failure.
  }
};

const removeTemporaryFile = async (
  system: NodeOutputPublicationSystem,
  path: string,
): Promise<void> => {
  try {
    await system.unlink(path);
  } catch {
    // Best-effort cleanup cannot replace the publication outcome already observed.
  }
};

const flushDirectory = async (
  system: NodeOutputPublicationSystem,
  directory: string,
): Promise<boolean> => {
  let handle: OutputDirectoryHandle | undefined;
  try {
    handle = await system.openDirectory(directory);
    await handle.sync();
    await handle.close();
    return true;
  } catch {
    await closeQuietly(handle);
    return false;
  }
};

export type FileCommit = Readonly<{
  status: 'published' | 'failed' | 'uncertain';
  committed: boolean;
}>;

export const writeCommittedFile = async (
  system: NodeOutputPublicationSystem,
  directory: string,
  filename: string,
  bytes: Uint8Array,
): Promise<FileCommit> => {
  const finalPath = join(directory, filename);
  const temporaryPath = join(directory, `.${filename}.revo-tmp`);
  let handle: OutputFileHandle | undefined;
  try {
    handle = await system.open(temporaryPath, 'wx', 0o600);
  } catch {
    return Object.freeze({ status: 'failed', committed: false });
  }
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
  } catch {
    await closeQuietly(handle);
    await removeTemporaryFile(system, temporaryPath);
    return Object.freeze({ status: 'failed', committed: false });
  }
  try {
    // `rename` would replace an existing result. A hard link is the POSIX
    // non-replacing atomic commit primitive; the temporary name is removed after it commits.
    await system.link(temporaryPath, finalPath);
  } catch (error) {
    await removeTemporaryFile(system, temporaryPath);
    return Object.freeze({
      status: existingPath(error) ? 'failed' : 'uncertain',
      committed: false,
    });
  }
  if (!(await flushDirectory(system, directory)))
    return Object.freeze({ status: 'uncertain', committed: true });
  await removeTemporaryFile(system, temporaryPath);
  return Object.freeze({ status: 'published', committed: true });
};

const evidenceFiles = (
  input: ClaimedOutputPublication,
): readonly (readonly [string, Uint8Array])[] => {
  const events = encodeBoundedEvents(input.events, input);
  return [
    ['events.ndjson', events],
    ['stdout.log', input.stdout],
    ['stderr.log', input.stderr],
    ...(input.rawResponse === undefined
      ? []
      : [['raw-final-response.txt', input.rawResponse] as const]),
  ];
};

const commitEvidenceFiles = async (
  system: NodeOutputPublicationSystem,
  directory: string,
  files: readonly (readonly [string, Uint8Array])[],
  index: number,
  committed: readonly string[],
): Promise<ClaimedOutputPublicationResult> => {
  const file = files[index];
  if (file === undefined)
    return Object.freeze({ status: 'published', files: Object.freeze(committed) });
  const [filename, bytes] = file;
  const result = await writeCommittedFile(system, directory, filename, bytes);
  const filesAfterCommit = result.committed ? [...committed, filename] : committed;
  if (result.status !== 'published')
    return Object.freeze({ status: result.status, files: Object.freeze(filesAfterCommit) });
  return commitEvidenceFiles(system, directory, files, index + 1, filesAfterCommit);
};

const writeEvidence = async (
  system: NodeOutputPublicationSystem,
  directory: string,
  input: ClaimedOutputPublication,
): Promise<ClaimedOutputPublicationResult> => {
  return commitEvidenceFiles(system, directory, evidenceFiles(input), 0, []);
};

const filesMatchResultManifest = (
  result: ClaimedOutputPublication['result'],
  committedFiles: readonly string[],
  directory: string,
): boolean => {
  const compareFilenames = (left: string, right: string): number => left.localeCompare(right);
  const actual = [...committedFiles, 'result.json'].sort(compareFilenames);
  const reported = [
    result.files.events,
    result.files.stdout,
    result.files.stderr,
    ...(result.files.rawFinalResponse === undefined ? [] : [result.files.rawFinalResponse]),
    ...(result.files.result === undefined ? [] : [result.files.result]),
  ].sort(compareFilenames);
  return (
    result.files.directory === directory &&
    actual.length === reported.length &&
    actual.every((filename, index) => filename === reported[index])
  );
};

export const createNodeClaimedOutputPublisher = (
  system: NodeOutputPublicationSystem = nodeOutputPublicationSystem,
): ClaimedInvocationOutputPublisher =>
  Object.freeze({
    publish: async (
      output: unknown,
      input: ClaimedOutputPublication,
    ): Promise<ClaimedOutputPublicationResult> => {
      const lease = beginOutputPublication(output);
      if (lease === undefined) return Object.freeze({ status: 'failed', files: Object.freeze([]) });
      try {
        let evidence: ClaimedOutputPublicationResult;
        try {
          evidence = await writeEvidence(system, lease.directory, input);
        } catch {
          evidence = Object.freeze({ status: 'failed', files: Object.freeze([]) });
        }
        if (evidence.status !== 'published') return evidence;
        if (!filesMatchResultManifest(input.result, evidence.files, lease.directory))
          return Object.freeze({ status: 'failed', files: evidence.files });
        const result = await writeCommittedFile(
          system,
          lease.directory,
          'result.json',
          encoder.encode(`${JSON.stringify(input.result)}\n`),
        );
        if (result.status === 'published')
          return Object.freeze({
            status: 'published',
            files: Object.freeze([...evidence.files, 'result.json']),
          });
        return Object.freeze({
          status: result.status,
          files: result.committed
            ? Object.freeze([...evidence.files, 'result.json'])
            : evidence.files,
        });
      } finally {
        lease.finish();
      }
    },
  });

export const nodeClaimedOutputPublisher = createNodeClaimedOutputPublisher();
