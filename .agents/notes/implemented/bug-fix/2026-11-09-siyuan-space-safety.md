# Agent Note: Preserve SiYuan Space safety and initialization

Status: implemented

English | [中文](2026-11-09-siyuan-space-safety.zh.md)

## Problem

Limited database search and delayed SQL indexing can cause duplicate Memories databases. Launcher failure handling, kernel discovery and the local initialization page also need explicit safety boundaries. Reusing a guide title without checking its content prevents updates.

## Decision

Flush SiYuan's transaction queue and inspect the target document's database blocks instead of searching globally. Preserve the first launcher failure, pass the access code in the environment, reject enabled network serving, and verify automatically discovered kernels against the supported checksum. An explicitly supplied kernel path remains the caller's responsibility. The local page denies framing and requires a single-use initialization token. Changed guides become additional documents; existing content is never overwritten.

## Alternatives considered

- Global database search is capped at 12 results and cannot establish absence.
- Replacing the existing guide risks losing user edits; a separate version preserves them.
- Trusting every kernel found on `PATH` silently executes an unverified binary.

## Consequences

Automatically discovered kernels are limited to the known macOS arm64 release; other verified installations need `SIYUAN_KERNEL`. The local token does not authenticate a process that can itself fetch the page. Concurrent bootstraps and platforms beyond the recorded test remain unverified.

## Verification

- Regression — `node scripts/memories/tests/verify-review.mjs`: exercises a real SiYuan kernel, the 12-result search limit, repeated initialization, guide preservation, launcher failures, page tokens and smoke cleanup; see [the verification report](../../../../docs/verification.md).
