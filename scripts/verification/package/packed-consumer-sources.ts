import { packedConsumerRuntime } from './consumer-runtime.js';
import { packedConsumerTypes } from './consumer-types.js';
import { packedFakeAcpBridge } from './fake-acp-bridge.js';

export const packedConsumerSources = (packageName: string) => ({
  consumerRuntime: packedConsumerRuntime(packageName, packedFakeAcpBridge),
  consumerTypes: packedConsumerTypes(packageName),
});
