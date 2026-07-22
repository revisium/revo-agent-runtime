export interface StrictSemVer {
  readonly source: string;
  readonly core: readonly [string, string, string];
  readonly prerelease: readonly string[];
  readonly build: readonly string[];
}
