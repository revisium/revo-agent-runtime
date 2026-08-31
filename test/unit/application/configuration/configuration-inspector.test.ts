import { expect, test } from 'vitest';

import { configurationInspectionStory } from '../../../support/stories/configuration-inspection.js';

test.each([
  [
    'an unsupported dynamic launch',
    configurationInspectionStory().useUnsupportedLaunch(),
    'failed',
  ],
  [
    'an uncertain primary start',
    configurationInspectionStory().primaryStartFails('uncertain-start'),
    'cleanup_uncertain',
  ],
  [
    'a confirmed primary start failure',
    configurationInspectionStory().primaryStartFails('confirmed-start'),
    'failed',
  ],
  [
    'an ordinary primary start failure',
    configurationInspectionStory().primaryStartFails('error'),
    'failed',
  ],
  ['protocol rejection', configurationInspectionStory().protocolRejects(), 'failed'],
  [
    'process exit before protocol opens',
    configurationInspectionStory().protocolExitsBeforeOpening(),
    'failed',
  ],
  [
    'uncertain cleanup before protocol opens',
    configurationInspectionStory().protocolRejects().primaryCleanupIsUncertain(),
    'cleanup_uncertain',
  ],
  ['protocol close rejection', configurationInspectionStory().protocolCloseFails(), 'failed'],
  ['protocol close timeout', configurationInspectionStory().protocolCloseHangs(), 'timed_out'],
  [
    'uncertain cleanup after protocol opens',
    configurationInspectionStory().primaryCleanupIsUncertain(),
    'cleanup_uncertain',
  ],
  [
    'an uncertain fallback start',
    configurationInspectionStory().useFallback().fallbackStartFails('uncertain-start'),
    'cleanup_uncertain',
  ],
  [
    'a confirmed fallback start failure',
    configurationInspectionStory().useFallback().fallbackStartFails('confirmed-start'),
    'failed',
  ],
  [
    'an ordinary fallback start failure',
    configurationInspectionStory().useFallback().fallbackStartFails('error'),
    'failed',
  ],
  [
    'uncertain fallback cleanup',
    configurationInspectionStory().useFallback().fallbackCleanupIsUncertain(),
    'cleanup_uncertain',
  ],
  ['fallback timeout', configurationInspectionStory().useFallback(), 'timed_out'],
  [
    'non-zero fallback exit',
    configurationInspectionStory().useFallback().fallbackExits({ exitCode: 1 }),
    'failed',
  ],
  [
    'signalled fallback exit',
    configurationInspectionStory().useFallback().fallbackExits({ signal: 'SIGTERM' }),
    'failed',
  ],
  [
    'truncated fallback output',
    configurationInspectionStory().useFallback().fallbackOutputIsTruncated().fallbackExits(),
    'failed',
  ],
  [
    'unparseable fallback output',
    configurationInspectionStory().useFallback().fallbackParseFails().fallbackExits(),
    'failed',
  ],
] as const)('fails safely for %s', async (_case, story, status) => {
  await expect(story.execute()).resolves.toMatchObject({ status });
});

test('publishes a parsed fallback catalog only after both processes are reaped', async () => {
  await expect(
    configurationInspectionStory().useFallback().fallbackExits().execute(),
  ).resolves.toMatchObject({ status: 'completed' });
});

test('reports cancellation and timeout while protocol opening remains pending', async () => {
  const cancelled = configurationInspectionStory().protocolHangs();
  cancelled.abort();
  await expect(cancelled.execute()).resolves.toMatchObject({ status: 'cancelled' });
  await expect(configurationInspectionStory().protocolHangs().execute()).resolves.toMatchObject({
    status: 'timed_out',
  });
});
