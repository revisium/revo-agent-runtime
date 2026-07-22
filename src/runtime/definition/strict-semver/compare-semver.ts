import type { StrictSemVer } from './strict-semver.js';

const compareText = (left: string, right: string): -1 | 0 | 1 => {
  if (left < right) return -1;
  if (left > right) return 1;

  return 0;
};

const compareDecimalIdentifiers = (left: string, right: string): -1 | 0 | 1 => {
  if (left.length < right.length) return -1;
  if (left.length > right.length) return 1;

  return compareText(left, right);
};

const isNumericIdentifier = (value: string): boolean => /^[0-9]+$/.test(value);

const comparePrereleaseIdentifiers = (left: string, right: string): -1 | 0 | 1 => {
  const leftNumeric = isNumericIdentifier(left);
  const rightNumeric = isNumericIdentifier(right);
  if (leftNumeric && rightNumeric) return compareDecimalIdentifiers(left, right);
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;

  return compareText(left, right);
};

export const compareSemVer = (left: StrictSemVer, right: StrictSemVer): -1 | 0 | 1 => {
  for (const index of [0, 1, 2] as const) {
    const difference = compareDecimalIdentifiers(left.core[index], right.core[index]);
    if (difference !== 0) return difference;
  }

  if (left.prerelease.length === 0 && right.prerelease.length > 0) return 1;
  if (left.prerelease.length > 0 && right.prerelease.length === 0) return -1;

  for (const [index, identifier] of left.prerelease.entries()) {
    const rightIdentifier = right.prerelease[index];
    if (rightIdentifier === undefined) return 1;

    const difference = comparePrereleaseIdentifiers(identifier, rightIdentifier);
    if (difference !== 0) return difference;
  }

  return left.prerelease.length < right.prerelease.length ? -1 : 0;
};
