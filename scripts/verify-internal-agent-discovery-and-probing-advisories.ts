import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const FINAL_WORKSPACE =
  'allowBuilds:\n  esbuild: false # tsx uses the platform package; no install script is required\n';
const ADVISORY_TIMEOUT_MS = 10_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isUnknownArray = (value: unknown): value is unknown[] => Array.isArray(value);

const assertFinalDependencyBaseline = (workspace: string, lock: string): void => {
  assert.equal(
    workspace,
    FINAL_WORKSPACE,
    'Workspace must match the final internal agent discovery and probing dependency baseline.',
  );
  assert.equal(
    workspace.includes('ajv>fast-uri'),
    false,
    'Workspace must not override Ajv fast-uri.',
  );
  assert.equal(
    workspace.includes('minimumReleaseAgeExclude'),
    false,
    'Workspace must not retain the expired release-age exception.',
  );
  assert.equal(workspace.includes('trustPolicy'), false, 'Workspace must not trust the lockfile.');
  assert.equal(
    /(?:^|\n)minimumReleaseAge:\s*0\s*(?:\n|$)/u.test(workspace),
    false,
    'Workspace must not disable minimum release age.',
  );
  assert.equal(
    lock.includes('fast-uri@3.1.2'),
    false,
    'Lockfile must not select vulnerable fast-uri@3.1.2.',
  );
  assert.equal(
    (lock.match(/^  fast-uri@3\.1\.4:\n    resolution:/gmu) ?? []).length,
    1,
    'Lockfile must contain exactly one fast-uri@3.1.4 package stanza.',
  );
};

const lock = await readFile(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
const workspace = await readFile(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8');
assertFinalDependencyBaseline(workspace, lock);

const expectedAdvisories = [
  {
    ghsaId: 'GHSA-4c8g-83qw-93j6',
    vulnerableVersionRange: '>= 2.3.1 <2.4.2; 3.0.0 <= 3.1.2; 4.0.0',
    patchedVersions: '2.4.2; 3.1.3; 4.0.1',
  },
  {
    ghsaId: 'GHSA-v2hh-gcrm-f6hx',
    vulnerableVersionRange: '>= 2.3.1, <= 2.4.2; >= 3.0.0, <= 3.1.3; >= 4.0.0, <= 4.1.0',
    patchedVersions: '2.4.3; 3.1.4; 4.1.1',
  },
] as const;

const verifyAdvisory = async (expected: (typeof expectedAdvisories)[number]): Promise<void> => {
  const url = `https://api.github.com/repos/fastify/fast-uri/security-advisories/${expected.ghsaId}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'revo-agent-runtime-dependency-audit',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(ADVISORY_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    throw new Error(`Primary advisory request timed out or failed for ${expected.ghsaId}.`, {
      cause: error,
    });
  }

  assert.equal(
    response.status,
    200,
    `Primary advisory endpoint returned ${response.status} for ${expected.ghsaId}.`,
  );

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error: unknown) {
    throw new Error(`Primary advisory endpoint returned invalid JSON for ${expected.ghsaId}.`, {
      cause: error,
    });
  }

  assert.ok(isRecord(payload));
  assert.equal(payload.ghsa_id, expected.ghsaId);
  assert.equal(payload.url, url);
  assert.equal(payload.severity, 'high');
  assert.equal(payload.state, 'published');
  assert.equal(payload.withdrawn_at, null);
  assert.ok(isUnknownArray(payload.vulnerabilities));
  assert.equal(payload.vulnerabilities.length, 1);
  const vulnerability = payload.vulnerabilities[0];
  assert.ok(isRecord(vulnerability));
  assert.ok(isRecord(vulnerability.package));
  assert.equal(vulnerability.package.ecosystem, 'npm');
  assert.equal(vulnerability.package.name, 'fast-uri');
  assert.equal(vulnerability.vulnerable_version_range, expected.vulnerableVersionRange);
  assert.equal(vulnerability.patched_versions, expected.patchedVersions);
};

await Promise.all(expectedAdvisories.map(verifyAdvisory));
console.log('fast-uri primary advisory check passed: GHSA-4c8g-83qw-93j6, GHSA-v2hh-gcrm-f6hx.');
