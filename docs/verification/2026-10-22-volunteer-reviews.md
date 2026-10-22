# #12 volunteer hours and certification review verification

Date: 2026-10-22

## Controlled SDK and CLI

- Final full validation on integration `7d5850c4363769bbed4554a57d1ed17f15cb3054`: `npm test` passed 75/75 tests, including the TypeScript build, packed SDK installation, real CLI subprocesses, #6 Ego preparation, and all existing suites.
- SDK public methods cover recognized transcript pagination/detail, real school-role derivation, review list/detail, explicit PASS and BACK intent, dry-run, callback-node selection, permission denial, processed-state business rejection, unknown pagination/state, lost/malformed write responses, and acknowledgement-versus-readback separation.
- CLI coverage uses a real subprocess against the built entry point and controlled school service. It checks help/schema, API and Ego-selected direct-API queries, explicit API confirmation, dry-run zero writes, and versioned JSON output.
- The Ego fixture captures the generated script, imports and executes it with a Node `data:` module, and records custom `taskSpace`, `page.goto`, `page.click`, `page.fill`, `page.snapshot`, and `task.handOff` actions. It rejects generated use of Playwright inference APIs, `task.finish`, write endpoints, or the page-level save action.
- Production frontend source was read only. It established the transcript endpoint/default body, review list/detail endpoints, real role mapping, visible PASS/BACK actions, callback-list dependency, PASS/BACK payloads, and the separate save PUT that preparation must not touch.

## Not verified

- No real Ego browser, real school login, real personal transcript, or real certification review page was operated for #12.
- No production certification decision, save PUT, final confirmation, or other production write was performed.
- Controlled tests do not prove that the current real role has review permission or that production returns the same records; those require a separate read-only live review and user-supervised visible preparation.
