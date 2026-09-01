import { discoverAgents } from '../../src/index.js';

const bounded = (value: string): string => value.slice(0, 128);
const result = await discoverAgents();

console.log('smoke:discover');
console.log(`definitions: ${result.definitions.length}`);
for (const definition of result.definitions) {
  console.log(`  ${bounded(definition.id)}@${bounded(definition.version)}`);
}
console.log(`diagnostics: ${result.diagnostics.length}`);
for (const diagnostic of result.diagnostics) {
  console.log(`  ${bounded(diagnostic.detectorId)}:${bounded(diagnostic.code)}`);
}
console.log(`modelObservations: ${result.modelObservations.length}`);
