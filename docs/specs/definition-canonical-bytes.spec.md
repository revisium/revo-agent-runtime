# Internal definition canonical-byte adapter specification

- Status: Accepted
- Version: 1.0.0
- Accepted: 2026-07-21
- Related decision: [ADR-0005](../adr/0005-audited-jcs-definition-identity.md)

The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, `MAY`, `REQUIRED`, and `OPTIONAL` in this document are to be
interpreted as described in RFC 2119 and BCP 14.

This specification defines the accepted Task 3A target. It does not claim that a canonical-byte adapter or definition
identity implementation currently exists.

## 1. Scope

The adapter converts one internal `JsonValue` into RFC 8785 canonical UTF-8 bytes for definition identity.

The adapter is internal. It MUST NOT create a public export, package subpath, or supported source deep import.

The adapter boundary is:

```text
JsonValue -> inspect and copy -> canonicalize once -> fresh UTF-8 Uint8Array
```

This specification does not define digesting, registry storage, public API behavior, or a generic architecture-verifier
rule.

## 2. Provider and ownership

The package dependency MUST be `canonicalize@3.0.0` with that exact version pin.

Exactly one production module in the definition layer MUST import `canonicalize`.

That module MUST be the canonical-byte adapter.

No other production module MUST import `canonicalize`.

No production module MUST provide another RFC 8785 canonicalization path.

The adapter MUST remain internal to the definition layer.

The adapter MUST NOT be re-exported from `src/index.ts` or a declared package entrypoint.

## 3. Input inspection and package-owned copy

The adapter MUST accept one internal `JsonValue`.

The adapter MUST inspect the input before creating its package-owned copy.

The inspection MUST reject unsupported values using the definition layer's established plain-JSON rules.

The copy MUST retain no caller-owned object, array, or buffer reference.

The adapter MUST construct the copy only from inspected data-property values and dense-array elements.

The adapter MUST NOT invoke a property getter, a `toJSON` method, or another caller-provided callback while inspecting or
copying.

An own callable `toJSON` property MUST be rejected before the provider is invoked.

A `toJSON` accessor MUST be rejected before its getter is invoked.

## 4. Canonical-byte result

The adapter MUST invoke `canonicalize` exactly once for each successful adapter call.

The sole invocation MUST receive the package-owned copy.

The adapter MUST encode the returned canonical JSON text as UTF-8.

The adapter MUST return a newly allocated `Uint8Array` containing those UTF-8 bytes.

The adapter MUST NOT cache, share, or retain the returned byte array.

## 5. Provider failure

If `canonicalize` returns `undefined`, the adapter MUST throw a new `AgentManagerError` with exactly this fault:

```ts
{
  code: 'revo.agent.internal',
  message: AGENT_FAULT_MESSAGES.internalConstruction,
  phase: 'construction',
  retryable: false,
}
```

If `canonicalize` throws, the adapter MUST throw a new `AgentManagerError` with that same fault.

The replacement fault MUST NOT include `details`.

The replacement error MUST NOT expose, retain, or use the original error as a cause.

The replacement fault and error message MUST NOT include the original error's message, name, stack, input, or provider
output.

## 6. Review acceptance criterion

Task 3A review MUST confirm that the adapter is the sole production importer of `canonicalize`.

That criterion applies to the Task 3A production-change review. It does not change the generic architecture verifier or
require a new generic architecture-verifier rule.

Task 3A verification MUST cover successful canonical bytes, hostile `toJSON` input, an `undefined` provider result, and a
throwing provider without original-error leakage.
