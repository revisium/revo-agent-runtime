export type { ExecutionBinding } from './execution-binding.js';
export type { InvocationExecutionPorts } from './execution-ports.js';
export { prepareInvocationPayloads } from './payload-preparation/index.js';
export type { PreparedInvocationPayloads } from './payload-preparation/index.js';
export type {
  PreparedInvocation,
  PreparedInvocationMaterial,
} from './prepared-invocation/index.js';
export {
  createPreparedInvocation,
  consumeOutputPreparationMaterial,
} from './prepared-invocation/index.js';
export { interpretArgumentTemplate } from './argument-template-interpretation/index.js';
export type { InterpretedArgumentTemplate } from './argument-template-interpretation/index.js';
export type {
  PermissionMappingResult,
  PermissionStrategyPort,
} from './permission-strategy-port/index.js';
export type {
  BoundedCommandObservation,
  BoundedCommandPort,
  BoundedCommandRequest,
  CommandResolution,
  RunningBoundedCommand,
} from './bounded-command-port/index.js';
export type {
  ChildEnvironmentCapture,
  ChildEnvironmentRequest,
} from './child-environment/index.js';
export { captureChildEnvironment } from './child-environment/index.js';
export { ExecutionBindingToken } from './execution-binding-token.js';
export type { InvocationTerminalObservation } from './execution-terminal-observation.js';
export { finalizeInvocationOutcome } from './finalize-invocation-outcome.js';
export { InvocationInputSnapshot } from './input-snapshot.js';
export { StartContextSnapshot } from './start-context-snapshot.js';
export { InvocationLifecycle } from './lifecycle.js';
export { freezeJsonValue } from './freeze-json-value.js';
export { normalizeInvocationOutcome } from './normalize-invocation-outcome.js';
export type { NormalizedInvocationFailureReason } from './normalized-invocation-failure-reason.js';
export type { NormalizedInvocationOutcome } from './normalized-invocation-outcome.js';
export type { OutputResourcePlan } from './output-resource-plan.js';
export type {
  OutputClaimAttempt,
  OutputClaimExclusiveCreatePort,
  OutputClaimExclusiveCreateRequest,
  ClaimedInvocationOutput,
  OutputClaimGuard,
  OutputClaimPlatformResult,
  OutputClaimQuiescence,
  OutputClaimReconciliation,
  OutputClaimResult,
} from './output-claim-attempt/index.js';
export {
  beginOutputClaim,
  createOutputClaimAttempt,
  inspectOutputClaimGuard,
} from './output-claim-attempt/index.js';
export type {
  ConsumedOutputPreparationMaterial,
  ConsumedRedactionMaterial,
  OutputPreparationAttempt,
  OutputPreparationFileSlot,
  OutputPreparationFileAttestation,
  OutputPreparationMutationPort,
  OutputPreparationMutationRequest,
  OutputPreparationPlatformResult,
  OutputPreparationQuiescence,
  OutputPreparationResult,
  PreparedInvocationResources,
  TerminalPublicationAuthority,
} from './output-preparation-attempt/index.js';
export {
  beginOutputPreparation,
  createOutputPreparationAttempt,
  takeOutputPreparationFileSlots,
  takePreparedInvocationResourcesPayload,
  takeRegisteredSecretsForRedaction,
} from './output-preparation-attempt/index.js';
export { PreparedLaunch } from './prepared-launch.js';
export type { RawResponseDiagnostic } from './raw-response-diagnostic.js';
export type { RedactionChannel } from './redaction/index.js';
export { createRedactionChannel } from './redaction/index.js';
export type {
  RedactingBoundedOutputSink,
  RedactingOutputGuardRequest,
} from './redacting-output-guard/index.js';
export { createRedactingBoundedOutputSink } from './redacting-output-guard/index.js';
export type {
  ParserFailureReason,
  ResultParserEndResult,
  ResultParserId,
  ResultParserPort,
  ResultParserUsage,
  ResultParserWriteResult,
} from './result-parser/index.js';
export type {
  AttachedProtocolSession,
  PreparedProtocolSession,
  ProtocolAttachResult,
  ProtocolDriverCreateRequest,
  ProtocolDriverId,
  ProtocolDriverPort,
  ProtocolObservationResult,
} from './protocol-driver/index.js';
export type { ResultSchemaValidator } from './result-schema-validator.js';
export type {
  PreparedExecutionSecurity,
  PreparedExecutionSecurityRequest,
} from './prepared-execution-security/index.js';
export {
  createPreparedExecutionSecurity,
  consumeRedactionMaterial,
  takePreparedChildEnvironment,
} from './prepared-execution-security/index.js';
export type {
  RegisteredSecrets,
  SealedSecretRegistration,
  SecretRegistrationRequest,
} from './secret-registration/index.js';
export { registerSecrets, revealRegisteredSecrets } from './secret-registration/index.js';
export type { WorkspaceAdmissionResult } from './workspace-admission-result.js';
export type {
  LiveOwnedProcess,
  ProcessIdentityInspectionResult,
  ProcessInputSink,
  ProcessIoActivationResult,
  ProcessStartAttempt,
  ProcessStartQuiescence,
  ProcessStartResult,
  RetainedCleanupAuthority,
  ProcessExitObservation,
  ProcessOutputSink,
  ProcessIdentity,
  ProcessStartRequest,
  ProcessSupervisionPort,
} from './process-supervision-port/index.js';
export {
  DuplexCoordinatorRegistration,
  InvocationTokenCarrier,
  PausedProcessIo,
  SpawnAcceptedProcess,
  beginProcessStart,
  createProcessStartAttempt,
  getProcessStartInvocationToken,
  settleProcessStart,
} from './process-supervision-port/index.js';
