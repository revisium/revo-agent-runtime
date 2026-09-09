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

`ci.yml` runs this experiment and the full existing `pnpm verify` on real
Ubuntu x64, macOS arm64, and Windows x64 runners. Matrix fail-fast is disabled;
failures remain failures. Full verification runs even if the experiment fails.
Package verification is also attempted after an earlier failure so platform
tooling issues remain visible. Sonar analysis stays on Linux to avoid competing
analyses of the same revision. The existing required `verify` check aggregates
all native jobs, so a failed platform cannot leave the required check green.

Existing runtime failures on macOS/Windows are baseline findings, not passing
support gates. Additional architectures and production integration follow only
after the initial native evidence. This PR remains draft throughout the experiment.
