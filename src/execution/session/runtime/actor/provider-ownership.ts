import type { SessionState } from '../../kernel/model/session-state.js';

export const ownsProviderResource = (state: SessionState, resourceId: string): boolean => {
  if ('providerResourceId' in state && state.providerResourceId === resourceId) return true;
  return (
    state.status === 'opening' &&
    'providerResourceId' in state.progress &&
    state.progress.providerResourceId === resourceId
  );
};
