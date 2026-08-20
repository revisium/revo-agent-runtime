import type { OutputClaimGuard } from './output-claim-guard.js';

export type OutputClaimQuiescence =
  | Readonly<{ status: 'quiescent'; syscallDispatched: boolean }>
  | Readonly<{ status: 'retained'; guard: OutputClaimGuard }>;
