export type OutputClaimPlatformResult =
  | Readonly<{ status: 'created' }>
  | Readonly<{ status: 'leaf_exists' }>
  | Readonly<{ status: 'create_failed' }>;
