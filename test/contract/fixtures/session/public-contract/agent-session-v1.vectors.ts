import type { AgentDefinitionSessionCapabilities } from '../../../../../src/contracts/agent-definition.js';
import type { AgentFault, AgentExecutionPin } from '../../../../../src/contracts/manager.js';
import type {
  ActiveAgentSessionSnapshot,
  ActiveAgentSessionStateMutationResult,
  AgentManagerInitialization,
  AgentSessionAction,
  AgentSessionAgentDescriptor,
  AgentSessionCapabilities,
  AgentSessionCheckpoint,
  AgentSessionEvent,
  AgentSessionEventAppendPrecondition,
  AgentSessionEventAppendResult,
  AgentSessionFilter,
  AgentSessionHibernateResult,
  AgentSessionInteractiveRequest,
  AgentSessionInteractiveResponse,
  AgentSessionLimits,
  AgentSessionManagerLimits,
  AgentSessionOutputPublication,
  AgentSessionPermissionOption,
  AgentSessionPlanItem,
  AgentSessionQuestion,
  AgentSessionResumeToken,
  AgentSessionSnapshot,
  AgentSessionTerminalFilter,
  AgentSessionTerminalRecord,
  AgentSessionTurnResult,
  AgentSessionUsage,
  AgentSessionStatus,
  CancelAgentSessionResult,
  CancelAgentSessionTurnResult,
  CloseAgentSessionResult,
  OpenAgentSession,
  RespondAgentSessionResult,
  ResumeAgentSession,
  SendAgentSessionInput,
} from '../../../../../src/contracts/session.js';

const pin = {
  agentId: 'codex-acp',
  agentVersion: '1.7.0',
  definitionDigest: 'definition-sha256',
} satisfies AgentExecutionPin;

const cursor = { eventId: 'evt_01', sequence: 1, streamId: 'stream_01' } as const;

const fault = {
  code: 'revo.agent.session_closed',
  message: 'Session is closed.',
  phase: 'session_terminal',
  retryable: false,
} satisfies AgentFault;

const capabilities = {
  interactions: { input: true, permission: true },
  multiTurn: true,
  resume: 'native',
  updates: { message: true, plan: true, progress: true, tool: true, usage: true },
} satisfies AgentSessionCapabilities;

const minimalCapabilities = {
  interactions: { input: false, permission: false },
  multiTurn: true,
  resume: 'none',
  updates: { message: true, plan: false, progress: false, tool: false, usage: false },
} satisfies AgentSessionCapabilities;

const declaredCapabilities = capabilities satisfies AgentDefinitionSessionCapabilities;

const usage = {
  inputTokens: 2,
  outputTokens: 3,
  scope: 'session_cumulative',
  totalTokens: 5,
} satisfies AgentSessionUsage;

const checkpoint = {
  checkpointId: 'chk_01',
  cursor,
  eligibility: 'observation_only',
  payload: 'eyJmb3JtYXQiOiJhY3AvdjEifQ',
  pin,
  schemaVersion: 'agent-session-checkpoint/v1',
  sessionId: 'dlg_01',
  sha256: 'checkpoint-sha256',
} satisfies AgentSessionCheckpoint;

const resumeToken = {
  cursor,
  eligibility: 'hibernated',
  payload: 'eyJmb3JtYXQiOiJhY3AvdjEifQ',
  pin,
  resumeTokenId: 'tok_01',
  schemaVersion: 'agent-session-resume-token/v1',
  sessionId: 'dlg_01',
  sha256: 'token-sha256',
} satisfies AgentSessionResumeToken;

const eventBase = {
  eventId: 'evt_02',
  observedAt: '2026-09-04T00:00:00.000Z',
  schemaVersion: 'agent-session-event/v1',
  sequence: 2,
  sessionId: 'dlg_01',
  streamId: 'stream_01',
} as const;

const inputRequest = {
  kind: 'input',
  message: 'Choose and explain.',
  questions: [
    {
      input: 'text',
      maxLength: 100,
      minLength: 1,
      multiline: true,
      questionId: 'q_text',
      required: true,
      title: 'Explanation',
    },
    {
      input: 'number',
      integer: true,
      maximum: 10,
      minimum: 1,
      questionId: 'q_number',
      required: true,
      title: 'Retries',
    },
    { input: 'boolean', questionId: 'q_boolean', required: false, title: 'Confirm' },
    {
      allowOther: true,
      input: 'select',
      options: [
        { label: 'Tests', optionId: 'tests' },
        { label: 'Docs', optionId: 'docs' },
      ],
      questionId: 'q_select',
      required: true,
      selection: 'multiple',
      title: 'Areas',
    },
  ],
  requestId: 'req_input',
} satisfies AgentSessionInteractiveRequest;

const permissionRequest = {
  action: { kind: 'edit', title: 'Edit source files' },
  kind: 'permission',
  options: [
    { kind: 'allow_once', label: 'Allow once', optionId: 'allow' },
    { kind: 'allow_always', label: 'Always allow', optionId: 'always_allow' },
    { kind: 'reject_once', label: 'Reject', optionId: 'reject' },
    { kind: 'reject_always', label: 'Always reject', optionId: 'always_reject' },
  ],
  requestId: 'req_permission',
} satisfies AgentSessionInteractiveRequest;

const publishedOutput = {
  files: {
    directory: '/output',
    manifest: 'session.json',
    stderr: 'stderr.log',
    stdout: 'stdout.log',
  },
  state: 'published',
} satisfies AgentSessionOutputPublication;

const snapshots = (
  [
    'opening',
    'idle',
    'running',
    'cancelling',
    'checkpointing',
    'hibernating',
    'closing',
    'cleanup_uncertain',
  ] as const
).map(
  (status) =>
    ({
      acceptedAt: '2026-09-04T00:00:00.000Z',
      capabilities,
      cursor,
      outputDirectory: '/output',
      pendingInteractions: [],
      pin,
      sessionId: 'dlg_01',
      status,
    }) satisfies AgentSessionSnapshot,
);

export const agentSessionPublicContractVectors = {
  agents: [
    {
      agent: { id: 'codex-acp', version: '1.7.0' },
      capabilities: {
        cancellation: true,
        session: capabilities,
        structuredResult: true,
        usage: true,
      },
      definitionDigest: 'definition-sha256',
      displayName: 'Codex ACP',
    },
  ] satisfies readonly AgentSessionAgentDescriptor[],
  activeStateMutationResults: [
    { state: 'applied' },
    { state: 'not_owner' },
  ] satisfies readonly ActiveAgentSessionStateMutationResult[],
  activeStateSnapshots: (
    ['opening', 'idle', 'running', 'cancelling', 'hibernating', 'closing'] as const
  ).map(
    (state) =>
      ({
        acceptedAt: '2026-09-04T00:00:00.000Z',
        incarnationId: 'inc_01',
        pin,
        process: {
          fingerprint: 'process-fingerprint',
          pid: 100,
          processGroupId: 100,
          startedAt: '2026-09-04T00:00:01.000Z',
        },
        sessionId: 'dlg_01',
        state,
      }) satisfies ActiveAgentSessionSnapshot,
  ),
  appendPreconditions: [
    { kind: 'empty' },
    { cursor, kind: 'cursor' },
    {
      cursor,
      kind: 'hibernation_token',
      resumeTokenId: 'tok_01',
      resumeTokenSha256: 'token-sha256',
    },
  ] satisfies readonly AgentSessionEventAppendPrecondition[],
  appendResults: [
    { state: 'appended' },
    { state: 'conflict' },
    { actual: cursor, state: 'conflict' },
  ] satisfies readonly AgentSessionEventAppendResult[],
  capabilities: {
    declared: declaredCapabilities,
    negotiated: [minimalCapabilities, capabilities],
  },
  checkpoints: { checkpoint, resumeToken },
  events: [
    { ...eventBase, pin, resumed: false, type: 'session.accepted' },
    {
      ...eventBase,
      pin,
      resumeTokenId: 'tok_01',
      resumeTokenSha256: 'token-sha256',
      resumed: true,
      type: 'session.accepted',
    },
    { ...eventBase, capabilities, pin, resumed: false, type: 'session.opened' },
    { ...eventBase, metadata: { source: 'user' }, turnId: 'trn_01', type: 'turn.started' },
    { ...eventBase, content: 'Hello', turnId: 'trn_01', type: 'assistant.message.delta' },
    {
      ...eventBase,
      contentBytes: 5,
      contentSha256: 'message-sha256',
      role: 'assistant',
      turnId: 'trn_01',
      type: 'assistant.message.completed',
    },
    { ...eventBase, message: 'Working', turnId: 'trn_01', type: 'agent.progress' },
    {
      ...eventBase,
      kind: 'edit',
      status: 'completed',
      title: 'Edit source',
      toolCallId: 'tool_01',
      turnId: 'trn_01',
      type: 'tool.activity',
    },
    {
      ...eventBase,
      items: [{ itemId: 'item_01', status: 'in_progress', title: 'Implement' }],
      turnId: 'trn_01',
      type: 'plan.updated',
    },
    {
      ...eventBase,
      request: permissionRequest,
      scope: { kind: 'turn', turnId: 'trn_01' },
      type: 'interaction.requested',
    },
    {
      ...eventBase,
      requestId: 'req_permission',
      response: { kind: 'permission', optionId: 'allow', outcome: 'selected' },
      scope: { kind: 'turn', turnId: 'trn_01' },
      type: 'interaction.resolved',
    },
    { ...eventBase, turnId: 'trn_01', type: 'usage.updated', usage },
    {
      ...eventBase,
      checkpointId: 'chk_01',
      checkpointSha256: 'checkpoint-sha256',
      type: 'session.checkpointed',
    },
    {
      ...eventBase,
      outcome: { status: 'completed', usage },
      turnId: 'trn_01',
      type: 'turn.completed',
    },
    {
      ...eventBase,
      outcome: { status: 'cancelled' },
      turnId: 'trn_cancelled',
      type: 'turn.completed',
    },
    {
      ...eventBase,
      outcome: { status: 'timed_out' },
      turnId: 'trn_timed_out',
      type: 'turn.completed',
    },
    {
      ...eventBase,
      outcome: { status: 'interrupted' },
      turnId: 'trn_interrupted',
      type: 'turn.completed',
    },
    {
      ...eventBase,
      outcome: { error: fault, status: 'failed' },
      turnId: 'trn_failed',
      type: 'turn.completed',
    },
    {
      ...eventBase,
      resumeTokenId: 'tok_01',
      resumeTokenSha256: 'token-sha256',
      type: 'session.hibernated',
    },
    { ...eventBase, outcome: 'closed', type: 'session.closed' },
    { ...eventBase, outcome: 'cancelled', type: 'session.closed' },
    { ...eventBase, error: fault, outcome: 'idle_timeout', type: 'session.closed' },
    { ...eventBase, error: fault, outcome: 'wall_clock_timeout', type: 'session.closed' },
    { ...eventBase, error: fault, outcome: 'failed', type: 'session.closed' },
  ] satisfies readonly AgentSessionEvent[],
  filters: {
    active: {
      agent: { id: 'codex-acp', version: '1.7.0' },
      sessionId: 'dlg_01',
      statuses: ['idle'],
    } satisfies AgentSessionFilter,
    terminal: {
      agent: { id: 'codex-acp', version: '1.7.0' },
      statuses: ['hibernated'],
    } satisfies AgentSessionTerminalFilter,
  },
  hibernateResults: [
    { resumeToken, state: 'hibernated' },
    { resumeToken, state: 'already_hibernated' },
  ] satisfies readonly AgentSessionHibernateResult[],
  initialization: [
    { invocations: [] },
    {
      invocations: [],
      sessions: [
        {
          acceptedAt: '2026-09-04T00:00:00.000Z',
          incarnationId: 'inc_01',
          pin,
          process: {
            fingerprint: 'process-fingerprint',
            pid: 100,
            processGroupId: 100,
            startedAt: '2026-09-04T00:00:01.000Z',
          },
          sessionId: 'dlg_01',
          state: 'idle',
        },
      ],
    },
  ] satisfies readonly AgentManagerInitialization[],
  interactionRequests: [permissionRequest, inputRequest],
  interactionResponses: [
    { kind: 'permission', optionId: 'allow', outcome: 'selected' },
    { kind: 'permission', outcome: 'denied' },
    { kind: 'input', outcome: 'submitted', values: { areas: ['tests', 'docs'], retries: 2 } },
    { kind: 'input', outcome: 'declined' },
    { kind: 'input', outcome: 'cancelled' },
  ] satisfies readonly AgentSessionInteractiveResponse[],
  interactionVocabulary: {
    actions: [
      { kind: 'read' },
      { kind: 'edit' },
      { kind: 'delete' },
      { kind: 'move' },
      { kind: 'search' },
      { kind: 'execute' },
      { kind: 'think' },
      { kind: 'fetch' },
      { kind: 'switch_mode' },
      { kind: 'other' },
    ] satisfies readonly AgentSessionAction[],
    permissionOptions: [
      { kind: 'allow_once', label: 'Allow once', optionId: 'allow_once' },
      { kind: 'allow_always', label: 'Always allow', optionId: 'allow_always' },
      { kind: 'reject_once', label: 'Reject once', optionId: 'reject_once' },
      { kind: 'reject_always', label: 'Always reject', optionId: 'reject_always' },
    ] satisfies readonly AgentSessionPermissionOption[],
    questions: [
      {
        input: 'text',
        maxLength: 100,
        multiline: false,
        questionId: 'q_text_minimal',
        required: false,
        title: 'Text',
      },
      {
        input: 'number',
        integer: false,
        questionId: 'q_number_minimal',
        required: false,
        title: 'Number',
      },
      { input: 'boolean', questionId: 'q_boolean_minimal', required: false, title: 'Boolean' },
      {
        allowOther: false,
        input: 'select',
        options: [{ label: 'One', optionId: 'one' }],
        questionId: 'q_single',
        required: true,
        selection: 'single',
        title: 'Single selection',
      },
      {
        allowOther: true,
        input: 'select',
        options: [{ label: 'One', optionId: 'one' }],
        questionId: 'q_multiple',
        required: true,
        selection: 'multiple',
        title: 'Multiple selection',
      },
    ] satisfies readonly AgentSessionQuestion[],
  },
  launch: {
    open: {
      agent: { id: 'codex-acp', version: '1.7.0' },
      limits: { maxPendingInteractions: 8 },
      metadata: { project: 'runtime' },
      output: { directory: '/output' },
      parameters: { model: 'provider/model' },
      permissions: { write: true },
      sessionId: 'dlg_01',
      workspace: { directory: '/workspace' },
    } satisfies OpenAgentSession,
    resume: {
      output: { directory: '/output/resumed' },
      parameters: {},
      permissions: {},
      token: resumeToken,
      workspace: { directory: '/workspace' },
    } satisfies ResumeAgentSession,
    send: {
      metadata: { source: 'user' },
      prompt: 'Continue.',
      turnId: 'trn_01',
    } satisfies SendAgentSessionInput,
  },
  limits: {
    manager: {
      activeStateOperationTimeoutMs: 5_000,
      maxActiveSessions: 32,
      maxCompletedSessions: 1_000,
      maxOpeningSessions: 4,
      maxSessionIdentities: 10_000,
      recoveryTimeoutMs: 30_000,
    } satisfies AgentSessionManagerLimits,
    session: {
      eventSinkTimeoutMs: 10_000,
      idleTimeoutMs: 900_000,
      maxCheckpointBytes: 1_048_576,
      maxEventBytes: 65_536,
      maxInteractionBytes: 262_144,
      maxMessageBytes: 4_194_304,
      maxMetadataBytes: 65_536,
      maxOutputBytes: 16_777_216,
      maxPendingInteractions: 8,
      maxPromptBytes: 1_048_576,
      openingTimeoutMs: 60_000,
      operationTimeoutMs: 30_000,
      wallClockTimeoutMs: 14_400_000,
    } satisfies AgentSessionLimits,
  },
  lifecycleResults: {
    cancelSession: [
      { state: 'requested' },
      { state: 'already_terminal' },
      { state: 'unknown' },
    ] satisfies readonly CancelAgentSessionResult[],
    cancelTurn: [
      { state: 'requested' },
      {
        result: { message: { content: 'Done', role: 'assistant' }, status: 'completed', usage },
        state: 'already_completed',
      },
      { state: 'session_terminal' },
    ] satisfies readonly CancelAgentSessionTurnResult[],
    close: [
      { state: 'closed' },
      { state: 'already_terminal' },
    ] satisfies readonly CloseAgentSessionResult[],
    respond: [
      { state: 'accepted' },
      { state: 'already_resolved' },
    ] satisfies readonly RespondAgentSessionResult[],
  },
  outputPublications: [
    publishedOutput,
    { error: fault, files: { directory: '/output' }, state: 'failed' },
    { error: fault, files: { directory: '/output' }, state: 'uncertain' },
  ] satisfies readonly AgentSessionOutputPublication[],
  snapshots,
  terminalRecords: [
    {
      acceptedAt: '2026-09-04T00:00:00.000Z',
      cleanup: 'confirmed',
      finishedAt: '2026-09-04T00:01:00.000Z',
      output: publishedOutput,
      pin,
      sessionId: 'dlg_01',
      status: 'closed',
    },
    {
      acceptedAt: '2026-09-04T00:00:00.000Z',
      cleanup: 'confirmed',
      finishedAt: '2026-09-04T00:01:00.000Z',
      pin,
      sessionId: 'dlg_02',
      status: 'cancelled',
    },
    {
      acceptedAt: '2026-09-04T00:00:00.000Z',
      cleanup: 'confirmed',
      finishedAt: '2026-09-04T00:01:00.000Z',
      pin,
      resumeToken,
      sessionId: 'dlg_01',
      status: 'hibernated',
    },
    {
      acceptedAt: '2026-09-04T00:00:00.000Z',
      cleanup: 'confirmed',
      error: fault,
      finishedAt: '2026-09-04T00:01:00.000Z',
      pin,
      sessionId: 'dlg_01',
      status: 'failed',
    },
    {
      acceptedAt: '2026-09-04T00:00:00.000Z',
      cleanup: 'confirmed',
      error: fault,
      finishedAt: '2026-09-04T00:01:00.000Z',
      pin,
      sessionId: 'dlg_03',
      status: 'timed_out',
    },
  ] satisfies readonly AgentSessionTerminalRecord[],
  turnResults: [
    { message: { content: 'Done', role: 'assistant' }, status: 'completed', usage },
    { status: 'cancelled' },
    { status: 'timed_out' },
    { status: 'interrupted' },
    { error: fault, status: 'failed' },
  ] satisfies readonly AgentSessionTurnResult[],
  vocabulary: {
    faultPhases: [
      'session_opening',
      'session_running',
      'session_delivery',
      'session_checkpointing',
      'session_recovery',
      'session_terminal',
    ] satisfies readonly AgentFault['phase'][],
    faultRetryability: [false, true] satisfies readonly AgentFault['retryable'][],
    planItemStatuses: [
      'pending',
      'in_progress',
      'completed',
    ] satisfies readonly AgentSessionPlanItem['status'][],
    sessionFaults: [
      { code: 'revo.agent.session_state_unavailable', retryable: false },
      { code: 'revo.agent.session_unsupported', retryable: false },
      { code: 'revo.agent.session_duplicate', retryable: false },
      { code: 'revo.agent.session_unknown', retryable: false },
      { code: 'revo.agent.session_closed', retryable: false },
      { code: 'revo.agent.session_busy', retryable: true },
      { code: 'revo.agent.session_capacity', retryable: true },
      { code: 'revo.agent.session_identity_capacity', retryable: false },
      { code: 'revo.agent.session_backpressure', retryable: true },
      { code: 'revo.agent.turn_duplicate', retryable: false },
      { code: 'revo.agent.turn_incomplete', retryable: true },
      { code: 'revo.agent.interaction_unknown', retryable: false },
      { code: 'revo.agent.interaction_conflict', retryable: false },
      { code: 'revo.agent.interaction_invalid', retryable: false },
      { code: 'revo.agent.checkpoint_invalid', retryable: false },
      { code: 'revo.agent.resume_token_invalid', retryable: false },
      { code: 'revo.agent.resume_token_consumed', retryable: false },
      { code: 'revo.agent.continuation_pin_mismatch', retryable: false },
      { code: 'revo.agent.checkpoint_unsupported', retryable: false },
      { code: 'revo.agent.continuation_too_large', retryable: false },
      { code: 'revo.agent.event_conflict', retryable: false },
      { code: 'revo.agent.event_sink_failed', retryable: true },
      { code: 'revo.agent.session_output_too_large', retryable: false },
    ] satisfies readonly Pick<AgentFault, 'code' | 'retryable'>[],
    sessionStatuses: [
      'opening',
      'idle',
      'running',
      'cancelling',
      'checkpointing',
      'hibernating',
      'closing',
      'cleanup_uncertain',
    ] satisfies readonly AgentSessionStatus[],
    toolKinds: [
      'read',
      'edit',
      'delete',
      'move',
      'search',
      'execute',
      'fetch',
      'other',
    ] satisfies readonly Extract<AgentSessionEvent, { type: 'tool.activity' }>['kind'][],
    toolStatuses: ['started', 'in_progress', 'completed', 'failed'] satisfies readonly Extract<
      AgentSessionEvent,
      { type: 'tool.activity' }
    >['status'][],
  },
};
