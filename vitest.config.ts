import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Removed in M10 after the session feature matrix and coverage-refactor pass.
      exclude: [
        'src/application/session/admission/**',
        'src/application/session/handles/**',
        'src/application/session/management/**',
        'src/composition/session/**',
        'src/execution/session/**',
        'src/platform/node/output/session/**',
        'src/platform/node/security/digest.ts',
        'src/platform/node/session/primitives/**',
        'src/protocol/acp/session/**',
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
