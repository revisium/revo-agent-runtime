import type { AgentSessionInteractiveRequest } from '../../../../../contracts/session/interaction/request.js';
import type {
  AgentSessionInputValue,
  AgentSessionInteractiveResponse,
} from '../../../../../contracts/session/interaction/response.js';

const sameValues = (
  left: Readonly<Record<string, string | number | boolean | readonly string[]>>,
  right: Readonly<Record<string, string | number | boolean | readonly string[]>>,
): boolean => {
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => {
    const leftValue = left[key];
    const rightValue = right[key];
    if (!Array.isArray(leftValue) || !Array.isArray(rightValue)) return leftValue === rightValue;
    return (
      leftValue.length === rightValue.length &&
      leftValue.every((value, index) => value === rightValue[index])
    );
  });
};

export const sameInteractionResponse = (
  left: AgentSessionInteractiveResponse,
  right: AgentSessionInteractiveResponse,
): boolean => {
  if (left.kind !== right.kind || left.outcome !== right.outcome) return false;
  if (left.kind === 'permission' && left.outcome === 'selected')
    return (
      right.kind === 'permission' &&
      right.outcome === 'selected' &&
      left.optionId === right.optionId
    );
  if (left.kind === 'input' && left.outcome === 'submitted')
    return (
      right.kind === 'input' &&
      right.outcome === 'submitted' &&
      sameValues(left.values, right.values)
    );
  return true;
};

type InputRequest = Extract<AgentSessionInteractiveRequest, { readonly kind: 'input' }>;
type Question = InputRequest['questions'][number];

const validText = (
  question: Extract<Question, { readonly input: 'text' }>,
  value: AgentSessionInputValue,
): boolean =>
  typeof value === 'string' &&
  (question.multiline || (!value.includes('\n') && !value.includes('\r'))) &&
  value.length >= (question.minLength ?? (question.required ? 1 : 0)) &&
  value.length <= question.maxLength;

const validNumber = (
  question: Extract<Question, { readonly input: 'number' }>,
  value: AgentSessionInputValue,
): boolean =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  (!question.integer || Number.isInteger(value)) &&
  (question.minimum === undefined || value >= question.minimum) &&
  (question.maximum === undefined || value <= question.maximum);

const knownOption = (
  question: Extract<Question, { readonly input: 'select' }>,
  value: string,
): boolean => question.options.some(({ optionId }) => optionId === value);

const isStringArray = (value: AgentSessionInputValue): value is readonly string[] =>
  Array.isArray(value);

const validSelect = (
  question: Extract<Question, { readonly input: 'select' }>,
  value: AgentSessionInputValue,
): boolean => {
  if (question.selection === 'single')
    return (
      typeof value === 'string' &&
      value.length > 0 &&
      (question.allowOther || knownOption(question, value))
    );
  if (!isStringArray(value) || (question.required && value.length === 0)) return false;
  return (
    new Set(value).size === value.length &&
    value.every(
      (answer) => answer.length > 0 && (question.allowOther || knownOption(question, answer)),
    )
  );
};

const validAnswer = (question: Question, value: AgentSessionInputValue): boolean => {
  if (question.input === 'text') return validText(question, value);
  if (question.input === 'number') return validNumber(question, value);
  if (question.input === 'boolean') return typeof value === 'boolean';
  return validSelect(question, value);
};

const validInputValues = (
  request: InputRequest,
  values: Readonly<Record<string, AgentSessionInputValue>>,
): boolean => {
  const questions = new Map(request.questions.map((question) => [question.questionId, question]));
  if (Object.keys(values).some((questionId) => !questions.has(questionId))) return false;
  return request.questions.every((question) => {
    if (!Object.hasOwn(values, question.questionId)) return !question.required;
    return validAnswer(question, values[question.questionId]!);
  });
};

export const validInteractionResponse = (
  request: AgentSessionInteractiveRequest,
  response: AgentSessionInteractiveResponse,
): boolean => {
  if (request.kind === 'permission') {
    if (response.kind !== 'permission') return false;
    return (
      response.outcome === 'denied' ||
      request.options.some(({ optionId }) => optionId === response.optionId)
    );
  }
  if (response.kind !== 'input') return false;
  return response.outcome !== 'submitted' || validInputValues(request, response.values);
};
