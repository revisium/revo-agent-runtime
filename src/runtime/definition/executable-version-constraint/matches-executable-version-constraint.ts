import { compareSemVer } from '../strict-semver/index.js';
import type { StrictSemVer } from '../strict-semver/index.js';
import type { ExecutableVersionConstraint } from './executable-version-constraint.js';
import type { VersionComparator } from './version-comparator.js';

const matchesComparator = (version: StrictSemVer, comparator: VersionComparator): boolean => {
  const difference = compareSemVer(version, comparator.version);

  switch (comparator.operator) {
    case '=':
      return difference === 0;
    case '>':
      return difference === 1;
    case '>=':
      return difference >= 0;
    case '<':
      return difference === -1;
    case '<=':
      return difference <= 0;
  }

  return false;
};

export const matchesExecutableVersionConstraint = (
  version: StrictSemVer,
  constraint: ExecutableVersionConstraint,
): boolean => constraint.comparators.every((comparator) => matchesComparator(version, comparator));
