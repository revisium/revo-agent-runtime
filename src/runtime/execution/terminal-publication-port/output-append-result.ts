export type OutputAppendResult =
  | Readonly<{ status: 'appended' }>
  | Readonly<{ status: 'suppressed'; reason: 'nonterminal_budget_exhausted' }>
  | Readonly<{ status: 'failed'; reason: 'write_failed' | 'flush_failed' }>;
