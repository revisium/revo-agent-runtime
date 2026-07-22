import { parseStrictSemVer } from '../strict-semver/index.js';
import type { ComparatorOperator } from './comparator-operator.js';
import type { ExecutableVersionConstraint } from './executable-version-constraint.js';
import type { VersionComparator } from './version-comparator.js';

const comparatorTokenPattern = /^(>=|<=|=|>|<)(.+)$/;

const isComparatorOperator = (value: string): value is ComparatorOperator =>
  value === '=' || value === '>' || value === '>=' || value === '<' || value === '<=';

export const parseExecutableVersionConstraint = (
  value: string,
): ExecutableVersionConstraint | undefined => {
  if (value.length === 0 || value.startsWith(' ') || value.endsWith(' ')) return undefined;

  const comparators: VersionComparator[] = [];
  for (const token of value.split(' ')) {
    const match = comparatorTokenPattern.exec(token);
    const operator = match?.[1];
    const versionSource = match?.[2];
    if (!operator || !versionSource || !isComparatorOperator(operator)) return undefined;

    const version = parseStrictSemVer(versionSource);
    if (!version) return undefined;

    comparators.push(Object.freeze({ operator, version }));
  }

  return Object.freeze({ source: value, comparators: Object.freeze(comparators) });
};
