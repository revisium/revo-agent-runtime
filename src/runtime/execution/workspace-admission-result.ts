export type WorkspaceAdmissionResult =
  | Readonly<{ status: 'admitted'; directory: string }>
  | Readonly<{
      status: 'rejected';
      reason: 'invalid_path' | 'missing' | 'not_directory' | 'unsupported_platform';
    }>;
