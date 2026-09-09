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
        'src/platform/node/process/windows/bindings.ts',
        'src/platform/node/process/windows/bootstrap.ts',
        'src/platform/node/process/windows/launcher.ts',
        'src/platform/node/process/windows/recovery.ts',
        'src/platform/node/process/windows/wait.ts',
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
