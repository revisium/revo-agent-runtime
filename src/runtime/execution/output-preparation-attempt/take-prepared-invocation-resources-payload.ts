import { PreparedInvocationResources } from './prepared-invocation-resources.js';

export const takePreparedInvocationResourcesPayload = (
  resources: unknown,
): ReturnType<typeof PreparedInvocationResources.take> =>
  PreparedInvocationResources.take(resources);
