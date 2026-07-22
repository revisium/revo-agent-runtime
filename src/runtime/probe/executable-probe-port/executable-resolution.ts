export type ExecutableResolution =
  | { readonly status: 'resolved'; readonly executable: string }
  | { readonly status: 'unavailable'; readonly reason: 'not_found' | 'not_launchable' };
