# Native Preview Smoke Test

Date: 2026-08-30

The native shell loaded at `http://127.0.0.1:4173/index.html#/dashboard` and rendered the Frostbyte dashboard with the loading screen transitioning to `CONNECTED`. The dashboard visibly includes validation score, artifact status, synthetic balance, offline readiness, release pipeline, release checklist, recent activity, and quick API controls.

The `Run validation` control appended a `Validation report refreshed` audit item and announced the update. The `Validation Center` route rendered eight layered checks: input validation, asset integrity, engine detection, rewrite policy, native API, offline shell, security scan, and performance. Seven checks were PASS and performance was WARN by design because no production baseline was measured.

No external runtime asset was required by the native package. The package uses the local service worker and synthetic API adapter.

Follow-up: the dashboard remained visually stable after returning from Validation Center. The `Collect fixture` button executed but reported failure; this requires runtime console inspection before release.

Debug: a direct browser-console call to `POST /collect` returned `{ ok: true, status: 200, status: "accepted", validation_id: … }`, so the adapter and session are healthy. The remaining issue is isolated to the UI event path or stale preview module state.

After patching `runNativeAction`, the preview reloaded normally with `CONNECTED` and the initial balance intact. The previous collect failure was caused by non-transaction responses overwriting the balance state with `undefined`, which triggered the subscriber formatter; the patch now updates balance only when numeric.

A second collect attempt still used the old cached module. The native service worker was serving cache-first shell JavaScript, so its cache name was bumped from `v1.0.0` to `v1.0.1`; the next reload showed the fresh bundle and reset the action status.

The collect failure persisted after the cache bump. Direct adapter calls still succeed and the click path produces no window error or unhandled rejection, which narrows the issue to an exception inside the action callback's own `try/catch`. This will be fixed by making the UI response formatting defensive and exposing the error code in the status text.

The cache-busted URL still reports `Collect fixture gagal` with no visible uncaught browser error. This indicates the remaining problem is not stale assets and is likely a synchronous exception from state persistence or telemetry inside the shared action path; the UI will be made resilient around those optional browser APIs.

The instrumented UI exposed the precise error: `INTERNAL_ERROR: updater is not a function`. The adapter succeeded, but `updateState` only accepted functions while action handlers passed patch objects. The state store now supports both forms, preserving the collect flow and error-boundary updates.
