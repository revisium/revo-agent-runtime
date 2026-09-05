import type { AgentFault } from '../../../../contracts/manager/core.js';
import type { AgentSessionOutputPublication } from '../../../../contracts/session/lifecycle/result.js';
import {
  beginOutputPublication,
  type ClaimedInvocationOutput,
} from '../../../../execution/output/claim.js';
import type { SessionOutputPublicationTarget } from '../../../../execution/output/session/publication.js';
import {
  nodeOutputPublicationSystem,
  type NodeOutputPublicationSystem,
  writeCommittedFile,
} from '../publication.js';

const encoder = new TextEncoder();

const publicationFault = (): AgentFault => ({
  code: 'revo.agent.output_write_failed',
  message: 'Session output publication failed.',
  phase: 'session_terminal',
  retryable: false,
});

type PublicationInput = Parameters<SessionOutputPublicationTarget['publish']>[0];

const manifestBytes = (input: PublicationInput): Uint8Array =>
  encoder.encode(
    `${JSON.stringify({
      acceptedAt: input.acceptedAt,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      files: { manifest: 'session.json', stderr: 'stderr.log', stdout: 'stdout.log' },
      finishedAt: input.finishedAt,
      ...(input.openedAt === undefined ? {} : { openedAt: input.openedAt }),
      pin: input.pin,
      schemaVersion: 'agent-session-output/v1',
      sessionId: input.sessionId,
      status: input.status,
      truncated: input.truncated,
    })}\n`,
  );

const failed = (
  directory: string,
  state: 'failed' | 'uncertain',
  committed: readonly string[],
): AgentSessionOutputPublication => ({
  error: publicationFault(),
  files: {
    directory,
    ...(committed.includes('stdout.log') ? { stdout: 'stdout.log' as const } : {}),
    ...(committed.includes('stderr.log') ? { stderr: 'stderr.log' as const } : {}),
    ...(committed.includes('session.json') ? { manifest: 'session.json' as const } : {}),
  },
  state,
});

export const createNodeSessionOutputTarget = (
  output: ClaimedInvocationOutput,
  system: NodeOutputPublicationSystem = nodeOutputPublicationSystem,
): SessionOutputPublicationTarget => {
  const target: SessionOutputPublicationTarget = {
    publish: async (input): Promise<AgentSessionOutputPublication> => {
      const lease = beginOutputPublication(output);
      if (lease === undefined) return failed('', 'failed', []);
      const committed: string[] = [];
      try {
        const files = [
          ['stdout.log', input.stdout],
          ['stderr.log', input.stderr],
          ['session.json', manifestBytes(input)],
        ] as const;
        const publishAt = async (index: number): Promise<AgentSessionOutputPublication> => {
          const file = files[index];
          if (file === undefined)
            return {
              files: {
                directory: lease.directory,
                manifest: 'session.json',
                stderr: 'stderr.log',
                stdout: 'stdout.log',
              },
              state: 'published',
            };
          const [filename, bytes] = file;
          const result = await writeCommittedFile(system, lease.directory, filename, bytes);
          if (result.committed) committed.push(filename);
          if (result.status !== 'published')
            return failed(lease.directory, result.status, committed);
          return publishAt(index + 1);
        };
        return await publishAt(0);
      } catch {
        return failed(lease.directory, 'failed', committed);
      } finally {
        lease.finish();
      }
    },
  };
  return Object.freeze(target);
};
