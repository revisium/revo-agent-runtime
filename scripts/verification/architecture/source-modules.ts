import { readdir, readFile } from 'node:fs/promises';
import { join, posix, relative } from 'node:path';

export interface SourceModule {
  readonly path: string;
  readonly source: string;
}

export const collectSourceModules = async (
  root: string,
  directory: string,
): Promise<readonly SourceModule[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry): Promise<readonly SourceModule[]> => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return collectSourceModules(root, path);
      if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) return [];

      return [
        {
          path: relative(root, path).replaceAll('\\', '/'),
          source: await readFile(path, 'utf8'),
        },
      ];
    }),
  );

  return nested.flat();
};

export const importSpecifiers = (source: string): readonly string[] =>
  [
    ...source.matchAll(/(?:import|export)\s+(?:[^'"()]+?\s+from\s+)?['"]([^'"]+)['"]/g),
    ...source.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
  ]
    .map((match) => match[1])
    .filter((specifier): specifier is string => specifier !== undefined);

export const resolvedRelativeModule = (path: string, specifier: string): string | undefined => {
  if (!specifier.startsWith('.')) return undefined;
  return posix.normalize(posix.join(posix.dirname(path), specifier.replace(/\.js$/, '.ts')));
};
