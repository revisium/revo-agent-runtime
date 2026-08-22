export type ProcessCleanupFailureCause =
  | 'inspection_timeout'
  | 'inspection_rejected'
  | 'group_state_unknown'
  | 'termination_rejected'
  | 'post_kill_confirmation_rejected'
  | 'group_still_live'
  | 'post_kill_confirmation_timeout'
  | 'leader_reap_timeout'
  | 'leader_reap_rejected';
