# ADR-0003: Record invocation output in an exact consumer directory

- Status: Accepted
- Date: 2026-07-15
- Amends: [ADR-0001](./0001-agent-runtime-boundary.md)

## Context

ADR-0001 assigned durable files and artifact persistence to the consumer. Revo already has a nested run, step, and attempt
layout, so a package-level root directory cannot derive the correct path. Requiring the consumer to duplicate stdout,
stderr, event, redaction, truncation, finalization, and atomic-result mechanics would nevertheless split one physical
invocation across two implementations.

## Decision

Narrowly amend ADR-0001: the runtime records invocation-local output files, while the consumer still owns path construction,
indexing, retention, restart recovery, and every durable workflow decision.

Every start request supplies one exact output directory whose leaf must not exist. The manager treats it as opaque, creates
missing parents, then atomically creates the leaf non-recursively. `EEXIST` always fails with `output_conflict`; the manager
never adopts, overwrites, deletes, rotates, or suffixes an existing leaf. Concurrent starts for one leaf have one winner.

Prompt and result-schema file delivery uses owner-only `<output.directory>/.scratch`. Controlled completion attempts cleanup
after process reap and before terminal commit. Cleanup failure becomes `scratch_cleanup_failed`; process crash may leave
residue. Consumer recovery or retention may remove the whole invocation directory.

The reserved files are:

- `events.ndjson` — bounded normalized events;
- `stdout.log` — bounded redacted process stdout;
- `stderr.log` — bounded redacted process stderr;
- `raw-final-response.txt` — bounded redacted raw final response, written only when result extraction, parsing, or validation
  fails;
- `result.json` — the atomic normalized terminal result when terminal persistence succeeds.

Redaction and byte bounds apply before subscriber delivery and before every file write. The manager publishes `result.json`
exclusively through a same-directory temporary file, file flush, hard link to the absent result path, directory flush where
supported, and temp unlink. It never uses replacing rename semantics; unsupported filesystem behavior fails with
`output_write_failed`.

Late recording failure cannot strand an accepted invocation. The manager derives a provisional result, reaps the process,
attempts scratch cleanup, and flushes non-terminal evidence. Scratch cleanup failure replaces the provisional value with
`scratch_cleanup_failed`; another pre-result recording failure uses `output_write_failed`. The manager attempts one exclusive
`result.json` commit; if that fails, it creates the same failed value in memory with no recursive persistence retry and no
`result.json` reference. It then commits the process-local completed record, best-effort appends the terminal filesystem
event, delivers exactly one process-local `invocation.finished`, and resolves waiters.

Failure to append the terminal event after a successful result commit adds a bounded process-local diagnostic and cannot
mutate that result. Exactly-one is a live manager delivery invariant, not a filesystem claim. Missing `result.json` or a
missing terminal NDJSON record means the consumer has an incomplete audit record for restart recovery.

## Consequences

- Revo may pass a path such as `runs/<run>/steps/<step>/attempts/<attempt>/agent` without exposing that structure to the
  package.
- A subscriber handling process-local `invocation.finished` can immediately obtain the completed result through
  `getResult`, even after late recording failure.
- Output conflicts fail closed and preserve prior evidence.
- Files are an invocation audit record, not a package-owned database or workflow index.
- A live terminal result may outlive a failed audit write; consumers must treat absent `result.json` or terminal NDJSON as
  incomplete recovery evidence rather than inventing success.
- Restart recovery remains out of v1 even though the consumer can retain the exact directory path.

## Rejected alternatives

- **Manager-level runs root:** couples the package to consumer hierarchy and naming.
- **Per-file consumer sinks:** forces every consumer to reproduce atomicity, bounds, redaction, and lifecycle ordering.
- **Overwrite or suffix on conflict:** can destroy evidence or disconnect workflow state from the actual files.
- **Write only a terminal event:** loses raw process evidence and cannot support late operational inspection.
