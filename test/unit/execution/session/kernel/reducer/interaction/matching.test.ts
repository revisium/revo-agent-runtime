import { expect, test } from 'vitest';

import { sameInteractionRequest } from '../../../../../../../src/execution/session/kernel/reducer/interaction/matching.js';
import {
  inputInteractionRequest,
  permissionInteractionRequest,
} from '../../../../../../support/session/builders/kernel/interactions.js';

test('compares nested interaction requests structurally', () => {
  expect(sameInteractionRequest(permissionInteractionRequest, permissionInteractionRequest)).toBe(
    true,
  );
  expect(
    sameInteractionRequest(permissionInteractionRequest, {
      ...permissionInteractionRequest,
      options: [...permissionInteractionRequest.options, permissionInteractionRequest.options[0]],
    }),
  ).toBe(false);
  expect(
    sameInteractionRequest(inputInteractionRequest, {
      ...inputInteractionRequest,
      questions: inputInteractionRequest.questions.map((question) => ({ ...question })),
    }),
  ).toBe(true);
  expect(
    sameInteractionRequest(inputInteractionRequest, {
      ...inputInteractionRequest,
      questions: inputInteractionRequest.questions.map((question, index) =>
        index === 0 ? { ...question, title: 'Different' } : question,
      ),
    }),
  ).toBe(false);
  expect(sameInteractionRequest(permissionInteractionRequest, inputInteractionRequest)).toBe(false);
});
