export interface FakeAcpDefinitionOptions {
  readonly command?: string;
  readonly configurationStateFile?: string;
  readonly descendantPidFile?: string;
  readonly displayName?: string;
  /** Definition-owned launch environment bindings. */
  readonly environment?: Readonly<Record<string, string>>;
  readonly id?: string;
  readonly mode?: string;
  readonly readyFile?: string;
  /** Version the fake CLI reports on preflight instead of the Node version. */
  readonly reportedVersion?: string;
  /** Declares and advertises native resume for checkpoint tests only. */
  readonly resume?: 'native';
  readonly session?: boolean;
  readonly traceFile?: string;
  readonly usage?: boolean;
  readonly version?: string;
  readonly withWorkspaceArg?: boolean;
}
