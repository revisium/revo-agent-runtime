# Roadmap

## Account-scoped usage status

Account or subscription usage remains deferred. It requires an approved host
contract for account identity, credential selection, secret ownership, cache
scope, and whether the host needs snapshots or active monitoring.

Configuration inspection and invocation token evidence do not establish an
account usage contract. A future design must keep provider support explicit,
return a typed unavailable result when no supported source exists, and never
infer quotas from model catalogs or scrape credentials, dashboards, private
files, or formatted logs.

Publication also remains blocked by the unresolved legal review described in
[Third-party bridge notices](../THIRD_PARTY_NOTICES.md).
