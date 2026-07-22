import type { VersionComparator } from './version-comparator.js';

export interface ExecutableVersionConstraint {
  readonly source: string;
  readonly comparators: readonly VersionComparator[];
}
