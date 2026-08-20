export interface OutputClaimExclusiveCreateRequest {
  readonly invocationId: string;
  readonly outputDirectory: string;
  markSyscallDispatched(): void;
}
