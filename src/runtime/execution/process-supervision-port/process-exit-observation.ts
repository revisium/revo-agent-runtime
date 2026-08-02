export interface ProcessExitObservation {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}
