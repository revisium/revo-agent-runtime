export type InterpretedArgumentTemplate = readonly (
  | Readonly<{ kind: 'arguments'; arguments: readonly string[] }>
  | Readonly<{ kind: 'prompt' }>
  | Readonly<{ kind: 'prompt-file' }>
  | Readonly<{ kind: 'result-schema' }>
  | Readonly<{ kind: 'result-schema-file' }>
)[];
