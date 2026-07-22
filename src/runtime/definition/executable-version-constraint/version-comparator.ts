import type { StrictSemVer } from '../strict-semver/index.js';
import type { ComparatorOperator } from './comparator-operator.js';

export interface VersionComparator {
  readonly operator: ComparatorOperator;
  readonly version: StrictSemVer;
}
