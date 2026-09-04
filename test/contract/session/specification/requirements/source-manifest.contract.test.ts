import { describe, expect, test } from 'vitest';

import { canonicalJsonBytes } from '../../../../support/session/specification/canonical/json-bytes.js';
import {
  readSessionRequirementManifest,
  validateSessionRequirementManifest,
} from '../../../../support/session/specification/fixtures/read-requirements.js';
import {
  readArtifactDigest,
  sha256,
} from '../../../../support/session/specification/fixtures/read.js';

const expectedSourcePin = '2fb61d1426809e8698e897adcfbd0d0050f58c2a';
const expectedGroups = { API: 16, DUR: 9, LIFE: 23, PROV: 7, ARCH: 9, VER: 8 } as const;

describe('session source requirement manifest', () => {
  test('validates the exact source identity, ids, grammar, and group counts', async () => {
    const manifest = await readSessionRequirementManifest();
    expect(manifest.schemaVersion).toBe('agent-session-requirements/v1');
    expect(manifest.sourcePin).toBe(expectedSourcePin);
    expect(manifest.requirementIds).toHaveLength(72);
    expect(new Set(manifest.requirementIds).size).toBe(72);
    expect(manifest.requirementIds.every((id) => /^[A-Z]+-\d{3}$/.test(id))).toBe(true);
    for (const [prefix, count] of Object.entries(expectedGroups))
      expect(manifest.requirementIds.filter((id) => id.startsWith(`${prefix}-`))).toHaveLength(
        count,
      );
  });

  test('matches the canonical UTF-8 digest', async () => {
    const [manifest, expected] = await Promise.all([
      readSessionRequirementManifest(),
      readArtifactDigest('requirements/source-requirements-v1.sha256'),
    ]);
    expect(sha256(canonicalJsonBytes(manifest))).toBe(expected);
  });

  test('rejects missing or changed source pin and malformed manifest shape', async () => {
    const manifest = await readSessionRequirementManifest();
    const { sourcePin: _sourcePin, ...withoutPin } = manifest;
    for (const invalid of [
      withoutPin,
      { ...manifest, sourcePin: 'changed' },
      { ...manifest, schemaVersion: 'wrong/v1' },
      { ...manifest, extra: true },
    ])
      expect(() => validateSessionRequirementManifest(invalid)).toThrow();
  });

  test('rejects duplicate, missing, malformed, reordered, and wrong-group ids', async () => {
    const manifest = await readSessionRequirementManifest();
    const cases = [
      { ...manifest, requirementIds: [...manifest.requirementIds.slice(0, -1), 'API-001'] },
      { ...manifest, requirementIds: manifest.requirementIds.slice(0, -1) },
      { ...manifest, requirementIds: ['API-invalid', ...manifest.requirementIds.slice(1)] },
      { ...manifest, requirementIds: [...manifest.requirementIds].reverse() },
      { ...manifest, requirementIds: ['API-017', ...manifest.requirementIds.slice(1)] },
    ];
    for (const invalid of cases)
      expect(() => validateSessionRequirementManifest(invalid)).toThrow();
  });

  test('rejects a semantically changed fixture even with a recomputed digest', async () => {
    const manifest = await readSessionRequirementManifest();
    const changed = {
      ...manifest,
      requirementIds: ['API-017', ...manifest.requirementIds.slice(1)],
    };
    const recomputed = sha256(canonicalJsonBytes(changed));
    expect(recomputed).not.toBe(sha256(canonicalJsonBytes(manifest)));
    expect(() => validateSessionRequirementManifest(changed)).toThrow();
  });
});
