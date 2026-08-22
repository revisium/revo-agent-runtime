import type { InvocationExecutionPorts } from '../../runtime/execution/index.js';
import { NodePosixOutputAdmissionPort } from './node-posix-output-admission-port.js';
import { NodePosixTerminalPublicationPort } from './node-posix-terminal-publication-port.js';

type Limits = ConstructorParameters<typeof NodePosixTerminalPublicationPort>[0];
type OutputPort = InvocationExecutionPorts['output'];

type Admit = OutputPort['admit'];
type AppendLifecycleEvent = OutputPort['appendLifecycleEvent'];
type PublishTerminalResult = OutputPort['publishTerminalResult'];
type PublishRawResponse = OutputPort['publishRawResponse'];
type CleanupScratch = OutputPort['cleanupScratch'];

export const createNodePosixInvocationOutputPort = (limits?: Limits): OutputPort => {
  const admission = new NodePosixOutputAdmissionPort();
  const publication = new NodePosixTerminalPublicationPort(limits);
  const admit: Admit = (request) => admission.admit(request);
  const appendLifecycleEvent: AppendLifecycleEvent = (authority, event) =>
    publication.appendLifecycleEvent(authority, event);
  const publishTerminalResult: PublishTerminalResult = (authority, result) =>
    publication.publishTerminalResult(authority, result);
  const publishRawResponse: PublishRawResponse = (authority, eligibility, bytes) =>
    publication.publishRawResponse(authority, eligibility, bytes);
  const cleanupScratch: CleanupScratch = (authority) => publication.cleanupScratch(authority);
  return Object.freeze({
    admit,
    appendLifecycleEvent,
    publishTerminalResult,
    publishRawResponse,
    cleanupScratch,
  });
};
