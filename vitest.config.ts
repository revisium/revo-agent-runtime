import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/platform/node/process/darwin.ts',
        'src/platform/node/process/platform.ts',
        'src/platform/node/process/posix.ts',
        'src/platform/node/process/identity.ts',
        'src/platform/node/process/recovered-process.ts',
        'src/platform/node/process/posix-recovery.ts',
        'src/platform/node/process/windows/**',
        'src/platform/node/output/windows/**',
        'src/platform/node/output/claim.ts',
        'src/platform/node/output/publication.ts',
        'src/platform/node/discovery/platform.ts',
        'src/platform/node/probe/executable-probe.ts',
      ],
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});
