import { ConsumedOutputPreparationMaterial } from '../output-preparation-attempt/consumed-output-preparation-material.js';
import { getOutputPreparationInvocationToken } from '../output-preparation-attempt/index.js';
import { PreparedInvocation } from './prepared-invocation.js';

export const consumeOutputPreparationMaterial = (
  invocation: unknown,
  attempt: unknown,
): ConsumedOutputPreparationMaterial | undefined => {
  if (!PreparedInvocation.isAuthentic(invocation)) return undefined;
  const invocationToken = getOutputPreparationInvocationToken(attempt);
  if (invocationToken === undefined) return undefined;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- attempt is unknown; only these two informational fields are read after registry authentication.
  const attemptFields = attempt as { invocationId?: unknown; outputDirectory?: unknown };
  if (
    invocation.invocationId !== attemptFields.invocationId ||
    invocation.outputDirectory !== attemptFields.outputDirectory
  )
    return undefined;
  const taken = PreparedInvocation.takeOutputPreparation(invocation);
  if (taken === undefined) return undefined;
  return ConsumedOutputPreparationMaterial.create({
    invocationId: taken.invocationId,
    outputDirectory: taken.outputDirectory,
    invocationToken,
    files: taken.files,
  });
};
