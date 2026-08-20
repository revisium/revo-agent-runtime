export type PermissionMappingResult =
  | Readonly<{ status: 'mapped'; arguments: readonly string[] }>
  | Readonly<{ status: 'omitted' }>
  | Readonly<{
      status: 'rejected';
      reason: 'permission_missing' | 'permission_invalid' | 'permission_denied';
    }>;
