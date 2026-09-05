import type {
  ActiveAgentSessionStateSink,
  AgentSession,
  AgentSessionCapabilities,
  AgentSessionCheckpoint,
  AgentSessionEvent,
  AgentSessionEventSink,
  AgentSessionManagerOptions,
  AgentSessionResumeToken,
  AgentSessions,
  AgentSessionTurn,
  OpenAgentSession,
  RespondAgentSessionRequest,
  ResumeAgentSession,
  SendAgentSessionInput,
} from '../../../src/contracts/session.js';
import type {
  AgentSession as RootAgentSession,
  AgentSessionEventSink as RootAgentSessionEventSink,
  AgentSessionResumeToken as RootAgentSessionResumeToken,
  AgentSessions as RootAgentSessions,
} from '../../../src/index.js';

declare const sessions: AgentSessions;
declare const session: AgentSession;
declare const turn: AgentSessionTurn;
declare const event: AgentSessionEvent;
declare const resumeToken: AgentSessionResumeToken;
declare const checkpoint: AgentSessionCheckpoint;
declare const readonlyOpenRequest: OpenAgentSession;

const openRequest = {
  agent: { id: 'codex-acp', version: '1.7.0' },
  output: { directory: '/output' },
  parameters: {},
  permissions: {},
  sessionId: 'dlg_01',
  workspace: { directory: '/workspace' },
} satisfies OpenAgentSession;

const response = {
  requestId: 'req_01',
  response: {
    kind: 'input',
    outcome: 'submitted',
    values: { approvals: ['tests', 'docs'], retries: 2 },
  },
} satisfies RespondAgentSessionRequest;

const eventSink = {
  async append(candidate, { expected, signal }) {
    void candidate.type;
    void expected.kind;
    void signal.aborted;
    return { state: 'appended' } as const;
  },
} satisfies AgentSessionEventSink;

const activeStateSink = {
  async remove(identity, { signal }) {
    void identity.incarnationId;
    void signal.aborted;
    return { state: 'applied' } as const;
  },
  async save(snapshot, { signal }) {
    void snapshot.state;
    void signal.aborted;
    return { state: 'applied' } as const;
  },
} satisfies ActiveAgentSessionStateSink;

const managerOptions = {
  activeStateSink,
  eventSink,
  limits: { maxActiveSessions: 32 },
} satisfies AgentSessionManagerOptions;

const openFunction: AgentSessions['open'] = async (request, context) => {
  void request.sessionId;
  void context?.signal?.aborted;
  return session;
};

const sendFunction: AgentSession['send'] = async (input, context) => {
  void input.turnId;
  void context?.signal?.aborted;
  return turn;
};

const resultFunction: AgentSessionTurn['result'] = async () => ({
  message: { content: 'Done', role: 'assistant' },
  status: 'completed',
});

const abortSignal = new AbortController().signal;
void sessions.open(openRequest, { signal: abortSignal });
void sessions.resume(
  {
    output: { directory: '/output/resumed' },
    parameters: {},
    permissions: {},
    token: resumeToken,
    workspace: { directory: '/workspace' },
  },
  { signal: abortSignal },
);
void session.send({ prompt: 'Continue.', turnId: 'trn_01' }, { signal: abortSignal });
void session.respond(response);
void event;
void managerOptions;
void openFunction;
void sendFunction;
void resultFunction;

// Required top-level fields remain required.
// @ts-expect-error A fresh session always names an agent.
const missingAgent: OpenAgentSession = {
  output: { directory: '/output' },
  parameters: {},
  permissions: {},
  sessionId: 'dlg_01',
  workspace: { directory: '/workspace' },
};
void missingAgent;

const missingNestedField = {
  ...openRequest,
  // @ts-expect-error Workspace is not a marker object; its directory is required.
  workspace: {},
} satisfies OpenAgentSession;
void missingNestedField;

const additionalOwnField = {
  ...openRequest,
  // @ts-expect-error Fresh literals cannot silently add a second resume channel.
  token: resumeToken,
} satisfies OpenAgentSession;
void additionalOwnField;

const invalidCapabilities = {
  interactions: { input: true, permission: true },
  multiTurn: true,
  // @ts-expect-error Resume capability is a closed literal union.
  resume: 'checkpoint',
  updates: { message: true, plan: true, progress: true, tool: true, usage: true },
} satisfies AgentSessionCapabilities;
void invalidCapabilities;

const missingNestedCapability = {
  interactions: { input: true, permission: true },
  multiTurn: true,
  resume: 'native',
  // @ts-expect-error Message delivery is the required session update baseline.
  updates: { plan: true, progress: true, tool: true, usage: true },
} satisfies AgentSessionCapabilities;
void missingNestedCapability;

const malformedDictionaryValue = {
  requestId: 'req_02',
  response: {
    kind: 'input',
    outcome: 'submitted',
    // @ts-expect-error Input dictionaries contain only the closed public value union.
    values: { createdAt: new Date() },
  },
} satisfies RespondAgentSessionRequest;
void malformedDictionaryValue;

// @ts-expect-error Exact optional properties reject explicit undefined.
const invalidOptionalPresence: SendAgentSessionInput = {
  metadata: undefined,
  prompt: 'Continue.',
  turnId: 'trn_02',
};
void invalidOptionalPresence;

const invalidResume = {
  // @ts-expect-error Resume identity and pin come only from the token.
  agent: { id: 'codex-acp', version: '1.7.0' },
  output: { directory: '/output/resumed' },
  parameters: {},
  permissions: {},
  token: resumeToken,
  workspace: { directory: '/workspace' },
} satisfies ResumeAgentSession;
void invalidResume;

const invalidCheckpoint = {
  ...checkpoint,
  // @ts-expect-error Observation checkpoints can never be used as resume tokens.
  eligibility: 'hibernated',
} satisfies AgentSessionCheckpoint;
void invalidCheckpoint;

// @ts-expect-error Public request values are immutable at every level.
readonlyOpenRequest.sessionId = 'dlg_02';
// @ts-expect-error Nested public request values are immutable too.
readonlyOpenRequest.workspace.directory = '/other';

declare const rootSession: RootAgentSession;
declare const rootSessions: RootAgentSessions;
declare const rootEventSink: RootAgentSessionEventSink;
declare const rootResumeToken: RootAgentSessionResumeToken;
void rootSession;
void rootSessions;
void rootEventSink;
void rootResumeToken;

// The continuation envelope is shared internally and absent from the public session barrel.
// @ts-expect-error Consumers cannot name the private continuation envelope.
type PublicEnvelope = import('../../../src/contracts/session.js').AgentSessionContinuationEnvelope;
declare const publicEnvelope: PublicEnvelope;
void publicEnvelope;
