# Native process experiment

This draft explores process primitives and native CI methods before changing the
runtime's public identity, persistence, or process adapters. It is not a released
cross-platform runtime implementation.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm poc:platform
```

Koffi 3.2.1 is a pinned development-only FFI dependency. Its install script is
disabled: the experiment must load the packaged native binary without compiling
on the consumer's machine. The npm runtime package does not include this experiment.

| Platform | Identity experiment                         | Owned shutdown experiment                                       |
| -------- | ------------------------------------------- | --------------------------------------------------------------- |
| Linux    | Existing procfs fingerprint                 | Separate POSIX process group                                    |
| macOS    | `proc_pidinfo(PROC_PIDTBSDINFO)` start time | Separate POSIX process group                                    |
| Windows  | `OpenProcess`, `GetProcessTimes`            | `AssignProcessToJobObject`, `TerminateJobObject`, kill-on-close |

The common admission boundary checks identity before termination. Real Node
fixtures announce readiness over IPC and create one descendant only after
admission. Tests establish stable identity, parent/descendant shutdown, and
refusal to terminate a live process with mismatched identity. Exit confirmation
is bounded; sending a signal alone is not success. No provider login or API call
is involved.

## Limits to resolve before production

- Windows assigns an already-running **cooperative test fixture** to a Job.
  Production admission must create the child suspended or otherwise assign its
  Job before arbitrary code can create descendants. This experiment does not
  close that race.
- POSIX identity-check-then-signal retains a race. Groups do not contain children
  that deliberately create a new session. No arbitrary-tree containment is claimed.
- macOS/Windows tokens only demonstrate start identity inside this test run;
  they are not durable identities across machines or boots.
- Linux assumes the CI runner has accessible procfs. Production recovery must
  distinguish unavailable procfs from an absent process, instead of copying this
  bounded experiment's handling into runtime.
- Graceful protocol shutdown, forced escalation, owner crashes, persistence
  migration, filesystem durability, and bundled-provider discovery need separate
  production slices.

## CI evidence

`ci.yml` exposes the gates from `pnpm verify` as separate steps. Tests with coverage
and packed-consumer verification run on real Ubuntu x64, macOS arm64, and Windows
x64 runners. Static checks, architecture, and Sonar run once on Linux. Matrix
fail-fast is disabled; independent gates run after earlier failures. The existing
required `verify` check aggregates all native jobs, so a failed platform cannot
leave the required check green.

The macOS test step temporarily uses `diagnose-tests.ts`: verbose and hanging-process
reporters, a process snapshot and Node diagnostic report after one minute, and
an Execa timeout after four minutes. Execa terminates the test process group;
separately detached runtime fixtures can escape that best-effort cleanup. The
outer step deadline remains six minutes. Reports exclude environment variables
and network diagnostics; process snapshots omit command arguments. Artifacts
are uploaded after the test step, when the runner still responds, and retained
for three days. A diagnostic failure never turns failed tests into a pass.

For a narrowed diagnostic run, append ordinary Vitest arguments:

```sh
node --import tsx scripts/platform-poc/diagnose-tests.ts test/unit/execution/process
```

Existing runtime failures on macOS/Windows are baseline findings, not passing
support gates. Additional architectures and production integration follow only
after the initial native evidence. This PR remains draft throughout the experiment.
