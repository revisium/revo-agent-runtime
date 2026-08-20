interface PreparedPayloadFile {
  readonly kind: 'prompt' | 'result-schema';
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface PreparedInvocationPayloads {
  readonly arguments: readonly string[];
  readonly stdin?: Uint8Array;
  readonly files: readonly PreparedPayloadFile[];
}
