# Native runtime verification

`pnpm poc:platform` exercises the production process launcher and recovery adapter
on Linux, macOS, and Windows. There is no second implementation in this harness.

The four bounded scenarios cover failed spawn without caller termination,
short-lived executable output, parent/descendant shutdown, and refusal to
terminate a process whose saved identity does not match.

CI runs these scenarios and the packed consumer on every OS. Runtime tests run
on every OS; coverage, static checks, architecture, and Sonar run once on Linux.
The required `verify` check requires every platform job to succeed.

## Upstream behavior used by the adapter

- [Execa 10 command resolution](https://github.com/sindresorhus/execa/blob/v10.0.1/lib/arguments/command-file.js)
  falls back to cmd.exe for unresolved Windows commands.
- [Execa's early-error tests](https://github.com/sindresorhus/execa/blob/v10.0.1/test/return/early-error.js)
  explicitly expect exit code 1 on Windows for a missing command.
- [Node's spawn-error test](https://github.com/nodejs/node/blob/v24.18.0/test/parallel/test-child-process-spawn-error.js)
  verifies that a missing executable emits ENOENT, has no PID, and never emits spawn.
  The Windows bootstrap uses this literal launch contract after discovery.
- [Execa's tree cleanup](https://github.com/sindresorhus/execa/blob/v10.0.1/lib/terminate/kill-descendants.js)
  uses best-effort taskkill on Windows. Runtime Job ownership remains separate
  because cleanup must include descendants after their immediate parent exits.

The PR remains draft until runtime, filesystem, discovery, and package checks
pass on all supported operating systems. A passing process harness alone is
not a support declaration.

For failure diagnosis, `diagnose-tests.ts` can run selected Vitest paths with
bounded process reports. It is not part of normal CI.
