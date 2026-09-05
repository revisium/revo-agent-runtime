import type { SessionEffectOutput } from '../../../../src/execution/session/runtime/effects/outcomes.js';

export const recordingSessionEffectOutput = () => {
  const outcomes: Parameters<SessionEffectOutput['outcome']>[0][] = [];
  const updates: Parameters<SessionEffectOutput['update']>[0][] = [];
  const output: SessionEffectOutput = {
    offerUpdate: (value) => {
      updates.push(value);
      return 'accepted';
    },
    outcome: (value) => void outcomes.push(value),
    update: async (value) => {
      updates.push(value);
      return 'processed';
    },
  };
  return { outcomes, output, updates };
};
