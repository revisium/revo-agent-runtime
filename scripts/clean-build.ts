import { rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

const repositoryRoot = process.cwd();
const buildDirectory = resolve(repositoryRoot, 'dist');

if (dirname(buildDirectory) !== repositoryRoot || basename(buildDirectory) !== 'dist') {
  throw new Error('Refusing to clean an unexpected build directory.');
}

await rm(buildDirectory, { force: true, recursive: true });
