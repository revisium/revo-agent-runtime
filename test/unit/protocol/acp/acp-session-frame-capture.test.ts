import { expect, test } from 'vitest';

import { AcpSessionFrameCapture } from '../../../../src/protocol/acp/session-frame-capture.js';

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

test('captures only the first valid raw session response', () => {
  const capture = new AcpSessionFrameCapture();
  for (const frame of [
    '',
    '{malformed',
    'null',
    '{"result":null}',
    '{"result":{"sessionId":42}}',
    '{"result":{"sessionId":"one","models":{}}}',
    '{"result":{"sessionId":"two"}}',
  ])
    capture.observe(bytes(frame));

  expect(capture.sessionResponse()).toEqual({ sessionId: 'one', models: {} });
});
