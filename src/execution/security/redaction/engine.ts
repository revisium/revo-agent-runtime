import {
  candidatesAt,
  concatBytes,
  type Candidate,
  type CompleteCandidate,
  type IncompleteCandidate,
} from './rules.js';

export type Processed =
  | Readonly<{ state: 'released'; output: Uint8Array }>
  | Readonly<{
      state: 'retained';
      start: number;
      candidate: IncompleteCandidate;
    }>;

interface RankedCandidate {
  readonly candidate: CompleteCandidate;
  readonly priority: number;
}

const candidatePriority = (candidate: Candidate): number => {
  if (candidate.state === 'complete') return 2;
  if (candidate.active) return 1;
  return 0;
};

const applicableCandidate = (candidate: Candidate, inputLength: number): RankedCandidate => {
  if (candidate.state === 'complete') return { candidate, priority: candidatePriority(candidate) };
  return {
    candidate: { state: 'complete', end: inputLength, replacement: candidate.replacement },
    priority: candidatePriority(candidate),
  };
};

const isPreferredCandidate = (
  candidate: RankedCandidate,
  current: RankedCandidate | undefined,
): boolean => {
  if (current === undefined) return true;
  if (candidate.candidate.end > current.candidate.end) return true;
  if (candidate.candidate.end < current.candidate.end) return false;
  return candidate.priority > current.priority;
};

const selectBestCandidate = (
  candidates: readonly Candidate[],
  inputLength: number,
): CompleteCandidate | undefined => {
  let best: RankedCandidate | undefined;
  for (const candidate of candidates) {
    const applicable = applicableCandidate(candidate, inputLength);
    if (isPreferredCandidate(applicable, best)) best = applicable;
  }
  return best?.candidate;
};

export function processCarry(
  input: Uint8Array,
  secretBytes: readonly Uint8Array[],
  final: true,
): Extract<Processed, { state: 'released' }>;
export function processCarry(
  input: Uint8Array,
  secretBytes: readonly Uint8Array[],
  final: false,
): Processed;
export function processCarry(
  input: Uint8Array,
  secretBytes: readonly Uint8Array[],
  final: boolean,
): Processed {
  const output: Uint8Array[] = [];
  let safeStart = 0;
  let offset = 0;
  while (offset < input.byteLength) {
    const candidates = candidatesAt(input, offset, secretBytes);
    const incomplete = candidates.find((candidate) => candidate.state === 'incomplete');
    if (!final && incomplete !== undefined)
      return { state: 'retained', start: offset, candidate: incomplete };
    const complete = selectBestCandidate(candidates, input.byteLength);
    if (complete === undefined) {
      offset += 1;
      continue;
    }
    output.push(input.subarray(safeStart, offset), complete.replacement);
    offset = complete.end;
    safeStart = complete.end;
  }
  output.push(input.subarray(safeStart));
  return { state: 'released', output: concatBytes(...output) };
}
