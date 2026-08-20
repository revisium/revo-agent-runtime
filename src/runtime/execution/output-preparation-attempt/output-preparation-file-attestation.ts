export type OutputPreparationFileAttestation = Readonly<{
  slot: 'prompt' | 'result-schema';
  path: string;
  byteLength: number;
  sha256: string;
}>;
