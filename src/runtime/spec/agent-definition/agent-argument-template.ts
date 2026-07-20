export type AgentArgumentTemplate =
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'workspace' }
  | { readonly kind: 'prompt' }
  | { readonly kind: 'prompt-file' }
  | { readonly kind: 'result-schema' }
  | { readonly kind: 'result-schema-file' }
  | { readonly kind: 'parameter'; readonly name: string; readonly omitIfMissing?: boolean }
  | { readonly kind: 'permission'; readonly name: string; readonly omitIfMissing?: boolean };
