import { expect, test } from 'vitest';

import { verifiedPublicOpenCodeModel } from './opencode-public-model.js';

const model = {
  id: 'big-pickle',
  providerID: 'opencode',
  api: { id: 'big-pickle', url: 'https://opencode.ai/zen/v1', npm: '@ai-sdk/openai-compatible' },
  cost: { input: 0, output: 0 },
};
const status = (value: unknown) => ({
  selectedModel: 'opencode/big-pickle',
  reportedVersion: '1.18.30',
  stdout: `opencode/big-pickle\n${JSON.stringify(value, null, 2)}\n`,
});

test('only the source-verified free default model on the official endpoint can run without cached login', () => {
  expect(verifiedPublicOpenCodeModel(status(model))).toBe(true);
  expect(verifiedPublicOpenCodeModel(status({ ...model, cost: { input: 1, output: 0 } }))).toBe(
    false,
  );
  expect(
    verifiedPublicOpenCodeModel(
      status({ ...model, api: { ...model.api, url: 'https://other.invalid' } }),
    ),
  ).toBe(false);
  expect(
    verifiedPublicOpenCodeModel({ ...status(model), selectedModel: 'opencode/paid-model' }),
  ).toBe(false);
  expect(verifiedPublicOpenCodeModel({ ...status(model), reportedVersion: 'unverified' })).toBe(
    false,
  );
  expect(
    verifiedPublicOpenCodeModel({ ...status(model), stdout: 'opencode/big-pickle\n{broken' }),
  ).toBe(false);
});
