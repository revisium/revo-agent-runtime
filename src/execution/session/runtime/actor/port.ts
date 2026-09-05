import type { PublicSessionCommand } from '../../kernel/command/public.js';

type SessionCommandAdmission = 'accepted' | 'coalesced' | 'rejected';

export interface SessionCommandDispatch {
  dispatch(command: PublicSessionCommand): { readonly state: SessionCommandAdmission };
}
