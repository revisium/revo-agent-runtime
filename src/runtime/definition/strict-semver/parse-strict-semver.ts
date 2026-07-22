import type { StrictSemVer } from './strict-semver.js';

const numericIdentifier = '(?:0|[1-9][0-9]*)';
const prereleaseIdentifier = `(?:${numericIdentifier}|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)`;
const buildIdentifier = '[0-9A-Za-z-]+';
const strictSemVerPattern = new RegExp(
  String.raw`^(${numericIdentifier})\.(${numericIdentifier})\.(${numericIdentifier})(?:-(${prereleaseIdentifier}(?:\.${prereleaseIdentifier})*))?(?:\+(${buildIdentifier}(?:\.${buildIdentifier})*))?$`,
);

export const parseStrictSemVer = (value: string): StrictSemVer | undefined => {
  const match = strictSemVerPattern.exec(value);
  if (!match) return undefined;

  const major = match[1];
  const minor = match[2];
  const patch = match[3];
  if (!major || !minor || !patch) return undefined;

  const core: readonly [string, string, string] = Object.freeze([major, minor, patch]);
  const prerelease = Object.freeze(match[4]?.split('.') ?? []);
  const build = Object.freeze(match[5]?.split('.') ?? []);

  return Object.freeze({ source: value, core, prerelease, build });
};
