import type { ClaimedOutputPublication } from '../../../src/execution/output/publication.js';
import type { ClaimedInvocationOutputPublisher } from '../../../src/execution/output/publication.js';

export interface TerminalPublicationStory {
  readonly publisher: ClaimedInvocationOutputPublisher;
  publication(): ClaimedOutputPublication | undefined;
  release(): void;
  waitUntilRequested(): Promise<void>;
}

/** Holds terminal publication so manager tests can observe its preceding lifecycle work. */
export const terminalPublicationStory = (): TerminalPublicationStory => {
  const requested = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  let publication: ClaimedOutputPublication | undefined;

  return {
    publisher: {
      publish: async (_output, input) => {
        publication = input;
        requested.resolve();
        await released.promise;
        return { files: [], status: 'published' };
      },
    },
    publication: () => publication,
    release: () => released.resolve(),
    waitUntilRequested: () => requested.promise,
  };
};
