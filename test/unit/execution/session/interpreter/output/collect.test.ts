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
