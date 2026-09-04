import type { AgentSessionInteractiveRequest } from '../../../../../contracts/session/interaction/request.js';

const sameUnknown = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right))
    return (
      left.length === right.length && left.every((value, index) => sameUnknown(value, right[index]))
    );
  if (
    left === null ||
    right === null ||
    typeof left !== 'object' ||
    typeof right !== 'object' ||
    Array.isArray(left) ||
    Array.isArray(right)
  )
    return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.hasOwn(right, key) && sameUnknown(Reflect.get(left, key), Reflect.get(right, key)),
    )
  );
};

export const sameInteractionRequest = (
  left: AgentSessionInteractiveRequest,
  right: AgentSessionInteractiveRequest,
): boolean => sameUnknown(left, right);
