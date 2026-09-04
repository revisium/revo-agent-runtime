const fileSystem = process.getBuiltinModule('node:fs');
const nodePath = process.getBuiltinModule('node:path');

const manifest = JSON.parse(
  fileSystem.readFileSync(nodePath.join(__dirname, 'architecture', 'layers.json'), 'utf8'),
);

const layerRules = manifest.layers.flatMap((layer) => {
  const allowed = new Set([layer.name, ...layer.dependencies]);
  const forbidden = manifest.layers
    .filter((candidate) => !allowed.has(candidate.name))
    .map((candidate) => `(?:${candidate.pattern})`);

  return forbidden.length === 0
    ? []
    : [
        {
          name: `${layer.name}-uses-declared-layers`,
          severity: 'error',
          from: { path: layer.pattern },
          to: { path: forbidden.join('|') },
        },
      ];
});

const providerNames = fileSystem
  .readdirSync(nodePath.join(__dirname, 'src', 'providers'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const providerIsolationRules = providerNames.map((provider) => ({
  name: `provider-${provider}-does-not-import-siblings`,
  severity: 'error',
  from: { path: `^src/providers/${provider}/` },
  to: {
    path: `^src/providers/(?!${provider}/)(?:${providerNames.join('|')})/`,
  },
}));

module.exports = {
  forbidden: [
    {
      name: 'no-cycles',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'source-imports-stay-in-source',
      severity: 'error',
      from: { path: '^src/' },
      to: { dependencyTypes: ['local'], pathNot: '^src/' },
    },
    {
      name: 'source-imports-must-resolve',
      severity: 'error',
      from: { path: '^src/' },
      to: { couldNotResolve: true },
    },
    {
      name: 'source-uses-production-dependencies-only',
      severity: 'error',
      from: { path: '^src/' },
      to: {
        dependencyTypes: [
          'npm-dev',
          'npm-optional',
          'npm-peer',
          'npm-bundled',
          'npm-no-pkg',
          'npm-unknown',
        ],
      },
    },
    {
      name: 'contracts-are-portable',
      severity: 'error',
      from: { path: '^src/contracts/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'application-does-not-use-node-builtins',
      severity: 'error',
      from: { path: '^src/application/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'core-does-not-spawn-processes',
      severity: 'error',
      from: { path: '^src/(?:application|execution)/' },
      to: { path: '(?:^|/node_modules/)execa(?:/|$)|^(?:node:)?child_process$' },
    },
    {
      name: 'protocol-ports-are-portable',
      severity: 'error',
      from: { path: '^src/protocol/(?:configuration-)?driver\\.ts$' },
      to: { path: '^(?:node:)|(?:^|/node_modules/)@agentclientprotocol/' },
    },
    {
      name: 'layers-do-not-import-root',
      severity: 'error',
      from: { path: '^src/(?!index\\.ts$)' },
      to: { path: '^src/index\\.ts$' },
    },
    {
      name: 'session-public-facades-hide-continuation-envelope',
      severity: 'error',
      from: { path: '^(?:src/index\\.ts|src/contracts/session\\.ts)$' },
      to: { path: '^src/contracts/session/continuation/envelope\\.ts$' },
    },
    ...providerIsolationRules,
    ...layerRules,
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    parser: 'swc',
  },
};
