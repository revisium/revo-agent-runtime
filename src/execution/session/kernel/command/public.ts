import type { RespondAgentSessionRequest } from '../../../../contracts/session/interaction/response.js';
import type { SendAgentSessionInput } from '../../../../contracts/session/requests/send.js';
import type { PublicCallCorrelation, TurnPublicCallCorrelation } from '../model/identity.js';
import type { SessionOpeningDescriptor, SessionOpeningRequest } from '../model/session-state.js';

interface PublicCommandBase {
  readonly call: PublicCallCorrelation;
  readonly observedAt: string;
}

type OpeningDescriptor<Kind extends SessionOpeningRequest['kind']> = Omit<
  SessionOpeningDescriptor,
  'request'
> & {
  readonly request: Extract<SessionOpeningRequest, { readonly kind: Kind }>;
};

interface OpenSessionCommand extends PublicCommandBase {
  readonly type: 'session.open';
  readonly opening: OpeningDescriptor<'fresh'>;
}

interface ResumeSessionCommand extends PublicCommandBase {
  readonly type: 'session.resume';
  readonly opening: OpeningDescriptor<'resume'>;
}

interface SendTurnCommand extends Omit<PublicCommandBase, 'call'> {
  readonly type: 'turn.send';
  readonly call: TurnPublicCallCorrelation;
  readonly input: SendAgentSessionInput;
}

interface RespondInteractionCommand extends PublicCommandBase {
  readonly type: 'interaction.respond';
  readonly input: RespondAgentSessionRequest;
}

interface CancelTurnCommand extends Omit<PublicCommandBase, 'call'> {
  readonly type: 'turn.cancel';
  readonly call: TurnPublicCallCorrelation;
  readonly turnId: string;
  readonly reason?: string;
}

interface CheckpointSessionCommand extends PublicCommandBase {
  readonly type: 'session.checkpoint';
  readonly checkpointId: string;
}

interface HibernateSessionCommand extends PublicCommandBase {
  readonly type: 'session.hibernate';
  readonly resumeTokenId: string;
  readonly reason?: string;
}

interface CloseSessionCommand extends PublicCommandBase {
  readonly type: 'session.close';
  readonly reason?: string;
}

interface CancelSessionCommand extends PublicCommandBase {
  readonly type: 'session.cancel';
  readonly reason?: string;
}

interface ShutdownSessionCommand extends PublicCommandBase {
  readonly type: 'manager.shutdown';
  readonly reason?: string;
}

export type PublicSessionCommand =
  | OpenSessionCommand
  | ResumeSessionCommand
  | SendTurnCommand
  | RespondInteractionCommand
  | CancelTurnCommand
  | CheckpointSessionCommand
  | HibernateSessionCommand
  | CloseSessionCommand
  | CancelSessionCommand
  | ShutdownSessionCommand;
