export interface FakeAcpDefinitionOptions {
  readonly command?: string;
  readonly configurationStateFile?: string;
  readonly descendantPidFile?: string;
  readonly displayName?: string;
  readonly id?: string;
  readonly mode?: string;
  readonly readyFile?: string;
  readonly session?: boolean;
  readonly traceFile?: string;
  readonly usage?: boolean;
  readonly withWorkspaceArg?: boolean;
}
