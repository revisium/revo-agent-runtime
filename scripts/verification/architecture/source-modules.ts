import { readdir, readFile } from 'node:fs/promises';
import { join, posix, relative } from 'node:path';

export interface SourceModule {
  readonly path: string;
  readonly source: string;
}

const collectModules = async (
  root: string,
  directory: string,
  include: (path: string) => boolean,
): Promise<readonly SourceModule[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry): Promise<readonly SourceModule[]> => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return collectModules(root, path, include);
      if (!entry.isFile() || !include(path)) return [];

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

export const collectSourceModules = async (
  root: string,
  directory: string,
): Promise<readonly SourceModule[]> =>
  collectModules(root, directory, (path) => path.endsWith('.ts') && !path.endsWith('.d.ts'));

export const collectLayoutModules = async (
  root: string,
  directory: string,
): Promise<readonly SourceModule[]> => collectModules(root, directory, () => true);

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
