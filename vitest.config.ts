import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Native Windows scenarios start several child processes within a single test.
    testTimeout: process.platform === 'win32' ? 15_000 : 5_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/process/node/darwin.ts',
        'src/process/node/platform.ts',
        'src/process/node/windows/bindings.ts',
        'src/process/node/windows/bootstrap.ts',
        'src/process/node/windows/launcher.ts',
        'src/process/node/windows/recovery.ts',
        'src/process/node/windows/wait.ts',
        'src/platform/node/output/windows/native.ts',
        'src/platform/node/output/platform.ts',
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
