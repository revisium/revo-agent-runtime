# Consumer-schema profile specification

- Status: Accepted
- Version: 1.0.0
- Implementation: Not implemented
- Target package: `@revisium/revo-agent-runtime`
- Related decision: [ADR-0004](../adr/0004-separate-validation-engines.md)

The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, `MAY`, `REQUIRED`, and
`OPTIONAL` in this document are to be interpreted as described in RFC 2119 and
BCP 14.

This specification is the accepted and authoritative target contract for Task 3B's
consumer-schema-profile admission boundary. It does not claim that consumer-schema-profile validation, schema
compilation, or result validation is implemented.

## 1. Scope and boundary

The consumer-schema profile admits a bounded subset of a consumer-supplied JSON Schema draft 2020-12
document before later schema compilation. It owns only resource admission, the
closed keyword profile, and a local acyclic reference graph. It does not
validate instances or the semantic value constraints of admitted JSON Schema
keywords.

The consumer-schema profile resource limits are admission limits for an already inspected schema. They
are not a hard time or memory bound for inspection. The consumer-schema profile MUST complete the
existing `inspectPlainJson` pass before it considers the root, depth, or node
limits. The consumer-schema profile MUST NOT add an early-abort mode, limit parameter, or alternate
Task 2A inspection path.

Task 3B MUST NOT import, invoke, expose, or map Ajv. Ajv compilation,
result-instance validation, and provider-diagnostic mapping belong to Task 3C.
No validator-native type may occur in the Task 3B verdict.

The target internal boundary is:

```ts
type ConsumerSchemaProfileValidation =
  | { readonly valid: true; readonly schema: JsonSchema202012 }
  | { readonly valid: false; readonly diagnostics: AgentValidationDetails };

declare function validateConsumerSchemaProfile(
  schema: unknown,
  instancePath: string,
): ConsumerSchemaProfileValidation;
```

`validateConsumerSchemaProfile` MUST return an outer frozen verdict. A successful verdict
MUST contain the exact caller-supplied root object, narrowed to
`JsonSchema202012`; it MUST NOT copy, reserialize, or deep-freeze that object.
An invalid verdict MUST contain the normalized, frozen diagnostics described in
section 4. The target signature remains internal and MUST NOT create a package
export or package subpath.

## 2. Required validation order

The validator MUST use the following stages in this exact order. A rejecting
stage MUST return before a later stage begins. A stage MAY collect more than one
diagnostic before returning its one invalid verdict.

Each consumer-schema profile rejecting stage MUST collect all raw `ValidationDiagnosticInput` values
that it produces, then call `normalizeValidationDiagnostics` exactly once to
create the stage verdict. The consumer-schema profile MUST expose only that bounded normalized details
value and MUST preserve its `truncated` value unchanged.

1. Inspect `schema` with `inspectPlainJson(schema, instancePath)`.
2. Reject a non-object root with `root_dialect`.
3. Apply the depth and node resource limits.
4. Apply the canonical-byte resource limit.
5. Apply the closed consumer-schema profile and collect schema locations.
6. Validate `$ref` siblings, locality, pointer syntax, and resolution.
7. Detect reference cycles.

`inspectPlainJson` is the Task 2A safety boundary. Its typed
`revo.agent.definition_invalid` failure, including failures for non-plain JSON,
cycles, non-finite numbers, unpaired surrogates, and hostile descriptors, MUST
propagate unchanged. The consumer-schema profile MUST NOT catch or translate that failure.

After inspection, a private inspected-root guard MUST require a JSON object as
the root. A boolean, array, or other inspected non-object root MUST return the
single `root_dialect` diagnostic at `instancePath`. The guard exists only to
narrow the inspected root for consumer-schema profile. It MUST preserve the Task 3A adapter contract
`canonicalizeJsonBytes(value: JsonValue): Uint8Array`; consumer-schema profile MUST NOT widen that
adapter or create another canonicalization path.

## 3. Resource admission

The inspected root's depth and nodes MUST be compared with
`AGENT_RUNTIME_LIMITS.schemaDepth` and `AGENT_RUNTIME_LIMITS.schemaNodes`.
Depth above 64 MUST produce `schema_depth`. Node count above 8,192 MUST produce
`schema_nodes`. Depth 64 and node count 8,192 are admitted. If either diagnostic
is present, consumer-schema profile MUST return without canonicalizing or profiling the schema.

Only after the depth/node stage succeeds, consumer-schema profile MUST call
`canonicalizeJsonBytes` with the guarded `JsonObject` and compare the returned
fresh `Uint8Array.byteLength` with `AGENT_RUNTIME_LIMITS.schemaBytes`. A size
above 1,048,576 bytes MUST produce the single `schema_bytes` diagnostic. Sizes
of 1,048,576 bytes or fewer are admitted. The consumer-schema profile MUST NOT use `JSON.stringify`,
`Buffer.byteLength`, `TextEncoder`, or another byte-counting path for this
limit.

## 4. Diagnostic contract

Every consumer-schema profile rejection MUST be built from `ValidationDiagnosticInput` values and
passed to `normalizeValidationDiagnostics`. The consumer-schema profile MUST NOT construct
`AgentValidationDetails` or normalized diagnostics directly. The normalizer
applies the repository's field and details bounds, sorts by UTF-8
`instancePath`, `schemaPath`, `keyword`, and `message` in that order, applies
the truncation tie-breakers, and freezes the returned details and diagnostics.

The caller MUST supply `instancePath` as either the empty string or a valid RFC
6901 JSON Pointer, without a URI fragment. The consumer-schema profile MUST preserve that value verbatim.
The consumer-schema profile MUST NOT validate, repair, or normalize it.

The consumer-schema profile uses two coordinate systems. A root-relative schema-location pointer begins
as the empty string at the schema root. The consumer-schema profile uses it only to register schema
locations, resolve local `$ref` values, construct reference edges, and detect
cycles. A diagnostic `instancePath` begins as the caller-supplied
`instancePath`. The consumer-schema profile uses it only for diagnostics. Child pointers in either
system append the same escaped JSON Pointer tokens (`~` as `~0`, `/` as `~1`).

Each consumer-schema profile diagnostic input MUST use the affected derived diagnostic
`instancePath`, `/<keyword>` as `schemaPath`, the table keyword as `keyword`,
and the exact table message as `message`. Root failures use the caller-supplied
`instancePath`.

| Keyword             | Exact message                                                  |
| ------------------- | -------------------------------------------------------------- |
| `keyword_allowlist` | `Keyword is not allowed by the consumer-schema profile.`       |
| `ref_acyclic`       | `Local reference graph must be acyclic.`                       |
| `ref_local`         | `Reference must be local to the root schema.`                  |
| `ref_pointer`       | `Reference must use an unencoded valid JSON Pointer fragment.` |
| `ref_resolved`      | `Reference must resolve to a schema location.`                 |
| `ref_siblings`      | `Reference schema contains forbidden sibling keywords.`        |
| `root_dialect`      | `Schema dialect must be declared exactly at the root.`         |
| `schema_bytes`      | `Schema canonical UTF-8 representation exceeds 1 MiB.`         |
| `schema_depth`      | `Schema JSON depth exceeds 64.`                                |
| `schema_location`   | `Value must be a boolean or object consumer schema.`           |
| `schema_nodes`      | `Schema JSON node count exceeds 8,192.`                        |

## 5. Closed profile and schema locations

The consumer-schema profile permits exactly these 20 schema-object keywords and no others:

```text
$schema                 $ref                    $defs
type                    enum                    const
properties              required                additionalProperties
items                   minLength               maxLength
minItems                maxItems                minimum
maximum                 exclusiveMinimum        exclusiveMaximum
multipleOf              uniqueItems
```

The consumer-schema profile MUST walk only schema locations. A schema location is a boolean subschema or
a JSON object. Boolean locations have no keywords and no child locations. The
walk registers the root under the empty root-relative schema-location pointer
and follows, in object-key order, every own member value of `$defs` and
`properties`, plus schema-valued `items` and `additionalProperties`.

The profile walk MUST register every discovered schema location under its
root-relative schema-location pointer. Registration MUST NOT use the diagnostic
`instancePath`.

`$defs` and `properties` are name maps, not schema locations. Their member
names are data and MUST NOT be checked against the keyword allowlist. Their
member values are schema locations. If `$defs` or `properties` is not a JSON
object, consumer-schema profile MUST report `schema_location` at that keyword's value path. If a
name-map member, `items`, or `additionalProperties` is neither a boolean nor a
JSON object, consumer-schema profile MUST report `schema_location` at that value's path.

At every object schema location, an own keyword outside the 20-keyword list
MUST collect `keyword_allowlist` at that keyword path. The consumer-schema profile MUST collect every
raw profile diagnostic found by this walk before normalizing the stage once and
returning before reference validation.

`$schema` MUST occur at the root and equal exactly
`https://json-schema.org/draft/2020-12/schema`. A missing or different root
value MUST report `root_dialect` at `instancePath`. `$schema` at a non-root
schema location MUST report `root_dialect` at its keyword path. The consumer-schema profile does not
otherwise validate the semantic values of admitted keywords in this task.

## 6. Local reference resolution

For each object schema location with `$ref`, consumer-schema profile MUST apply the sibling rule.
In this section, a `$ref` or sibling path is its derived diagnostic
`instancePath`.
At the root, the only permitted own siblings are `$schema`, `$ref`, and `$defs`.
At any non-root location, `$ref` is the only permitted own keyword. Each other
permitted-profile sibling MUST report `ref_siblings` at that sibling's path.

Each `$ref` value MUST be a string equal to `#` or beginning with `#/`.
Otherwise it MUST report `ref_local` at the `$ref` path. A local fragment that
contains `%` MUST report `ref_pointer` at that path. For a `#/` fragment, split
the remaining text on `/`; each `~` escape MUST be exactly `~0` or `~1`.
Another `~` escape MUST report `ref_pointer` at the `$ref` path. `~0` decodes to
`~`, `~1` decodes to `/`, and `#` has no tokens and denotes the root.

Only a local reference that passes the preceding syntax rules is resolved. `#`
and a `#/` fragment MUST resolve in root-relative schema-location-pointer space
and MUST NOT be affected by the caller-supplied diagnostic `instancePath`. The consumer-schema profile
MUST traverse decoded tokens from the root through own data properties. Its
destination MUST be the exact value registered by the profile walk as a schema
location. An absent property or a value that is not a registered schema
location MUST report `ref_resolved` at the derived diagnostic path for `$ref`.
This forbids references to keyword values, name maps, and arbitrary JSON values.

The consumer-schema profile MUST collect every raw sibling, locality, pointer, and resolution diagnostic
for this stage before normalizing the stage once and returning before cycle
detection if any are present.

## 7. Acyclic reference graph

After reference resolution succeeds, each schema location with `$ref` defines
one directed edge from that location to its resolved schema location. The consumer-schema profile MUST
sort the collected root-relative schema-location pointers in ascending UTF-8
byte lexicographic order, with the empty root pointer first. It MUST start
depth-first traversal at each white root-relative pointer in that order.
Traversal MUST color a node gray on entry and black after its outgoing edge is
processed. An edge to a gray destination MUST collect `ref_acyclic` at the
derived diagnostic path for the source location's `$ref`. Self-references,
including `#` at the root and a `$defs` member referring to itself, are cycles.

If consumer-schema profile finds one or more cycles, it MUST normalize the collected raw
`ref_acyclic` diagnostics once and return an invalid verdict. Otherwise it MUST
return the frozen successful verdict described in section 1. Shared references
with no gray-edge cycle are valid.
