import { expect, it } from 'vitest';

import { SessionOutputCollector } from '../../../../../../src/execution/session/interpreter/output/collect.js';

it('shares one byte budget, marks truncation, and finalizes exactly once', () => {
  const collector = new SessionOutputCollector(80, []);
  collector.writeStdout(new TextEncoder().encode('a'.repeat(100)));
  collector.writeStderr(new TextEncoder().encode('b'.repeat(100)));
  const first = collector.finalize();
  collector.writeStdout(new TextEncoder().encode('ignored'));
  const second = collector.finalize();

  expect(second).toBe(first);
  expect(first.stdout.byteLength + first.stderr.byteLength).toBeLessThanOrEqual(80);
  expect(first.truncated).toEqual({ stderr: true, stdout: true });
  expect(new TextDecoder().decode(first.stdout)).toContain('[output truncated]');
  expect(new TextDecoder().decode(first.stderr)).toContain('[output truncated]');
});

it('redacts secrets split across writes before retaining bytes', () => {
  const collector = new SessionOutputCollector(128, ['secret']);
  collector.writeStdout(new TextEncoder().encode('value=sec'));
  collector.writeStdout(new TextEncoder().encode('ret'));
  expect(new TextDecoder().decode(collector.finalize().stdout)).toBe('value=[REDACTED]');
});

it.each([0, 39, Number.NaN])('rejects an invalid shared output limit: %s', (limit) => {
  expect(() => new SessionOutputCollector(limit, [])).toThrow('byte limit');
});

it('retains untruncated stdout and stderr without markers', () => {
  const collector = new SessionOutputCollector(128, []);
  collector.writeStdout(new TextEncoder().encode('out'));
  collector.writeStderr(new TextEncoder().encode('err'));

  const result = collector.finalize();
  expect(new TextDecoder().decode(result.stdout)).toBe('out');
  expect(new TextDecoder().decode(result.stderr)).toBe('err');
  expect(result.truncated).toEqual({ stderr: false, stdout: false });
});
