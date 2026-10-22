# #12 volunteer hours and certification review verification

Date: 2026-10-22

## Controlled SDK and CLI

- Main review validation on #12 branch `feat/issue-12-volunteer-review` after integration `d7a2bbd`: `npm test` passed 94/94 tests, including the TypeScript build, packed SDK installation, real CLI subprocesses, #6 Ego preparation, strict #12 DOM execution, and all existing suites.
- SDK public methods cover recognized transcript pagination/detail, real school-role derivation, review list/detail, explicit PASS and BACK intent, dry-run, callback-node selection, permission denial, processed-state business rejection, unknown pagination/state, lost/malformed write responses, and acknowledgement-versus-readback separation. Decisions re-check the real-time account, school-returned pending membership, exact application UUID, and list/detail activity binding; a server rejection before fixture recording is still counted as a real write attempt. Lost writes keep `UNKNOWN_OUTCOME` when readback changes, while a 503 readback reports `readback:unavailable`.
- CLI and Node preparation coverage uses a real subprocess/Node entry point against a controlled school service. It checks that preparation creates a fresh review SDK client from the verified session and rejects a changed account before launching the Ego command, then verifies the binding returned to CLI output.
- The Ego fixture is strict jsdom DOM execution, not canned callback return values. It executes the generated script and records actual-style multiline snapshots and same-origin iframe DOM, clicks, fills, evaluate calls, navigation, handoff, non-GET fetch attempts, external save clicks, and final-confirm clicks. Coverage requires a snapshot before the action click, reuses an already matching page, rejects unrelated pages, permits `about:blank` only with the explicit blank-navigation option, preserves nonempty human textarea input, and confirms zero remote writes, external saves, final confirms, and exactly one handoff. It also rejects generated use of Playwright inference APIs, `task.finish`, write endpoints, DOM mutation selectors, and fabricated write-count markers.
- Production frontend source was read only. It established the transcript endpoint/default body, review list/detail endpoints, real role mapping, visible PASS/BACK actions, callback-list dependency, PASS/BACK payloads, and the separate save PUT that preparation must not touch.

## Current school read-only verification

Main ran the real CLI against the current Ego session: `volunteer-hours list --via ego --page-size 1` returned success, zero items and `hasMore:false`; request mode was direct API. `volunteer-certification-reviews list --via ego` returned `PERMISSION_DENIED` because the school account did not expose a real review role. It did not select an arbitrary administrator handle or make a decision.

Main also corrected aggregate flow endpoints to `/gateway/ek-agg-mob/biz-common/flow/...` with the aggregate appkey. Controlled fixtures now reject the previously wrong URL. Visible preparation reuses the source-backed `.action-bar` / `.van-dialog` adapter, reads actual named controls inside the school iframe, preserves existing dialog content, and validates the visible account before editing. SDK and CLI retain `UNKNOWN_OUTCOME` after a lost fill receipt, with one handoff and no save/final confirmation.

## Not verified

The real account lacks certification review permission, so no real certification decision dialog or final confirmation was exercised. No production certification decision, save PUT, or other write occurred. Controlled review fixtures are not a substitute for production review permission or a user-submitted result. Personal read-only responses remain outside the public repository.
