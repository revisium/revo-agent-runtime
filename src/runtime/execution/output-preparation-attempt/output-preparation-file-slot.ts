export interface OutputPreparationFileSlot {
  readonly slot: 'prompt' | 'result-schema';
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly expectedByteLength: number;
  readonly expectedSha256: string;
}
