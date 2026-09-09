const compiledArtifactsFor = (sourceFile: string): readonly string[] => {
  const compiledModule = `dist/${sourceFile.slice(0, -3)}`;
  return [
    `${compiledModule}.d.ts`,
    `${compiledModule}.d.ts.map`,
    `${compiledModule}.js`,
    `${compiledModule}.js.map`,
  ];
};

export const expectedPackedPaths = (sourceFiles: readonly string[]): readonly string[] =>
  [
    'adapters/codex-acp.mjs',
    'adapters/claude-agent-acp.mjs',
    'adapters/NOTICE.txt',
    'LICENSE',
    'README.md',
    'THIRD_PARTY_NOTICES.md',
    ...sourceFiles
      .filter((path) => path.endsWith('.ts') && !path.endsWith('.d.ts'))
      .flatMap(compiledArtifactsFor),
    'package.json',
  ].sort();
