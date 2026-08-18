export type ChildEnvironmentCapture =
  | Readonly<{
      status: 'captured';
      environment: Readonly<Record<string, string>>;
      secretValues: readonly string[];
    }>
  | Readonly<{
      status: 'rejected';
      reason:
        | 'invalid_request'
        | 'invalid_key'
        | 'credential_like_name'
        | 'duplicate_name'
        | 'missing_inherit_variable'
        | 'empty_secret_value'
        | 'too_many_keys'
        | 'key_too_large'
        | 'value_too_large'
        | 'total_size_exceeded';
    }>;
