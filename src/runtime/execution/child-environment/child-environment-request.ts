export interface ChildEnvironmentRequest {
  readonly inherit: readonly string[];
  readonly variables: Readonly<Record<string, string>>;
  readonly secrets: Readonly<Record<string, string>>;
}
