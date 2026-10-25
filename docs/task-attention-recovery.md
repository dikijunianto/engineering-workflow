# Task attention recovery — 2026-10-23

Quest Refactor Modul PIN had T1/T10 blocked before worktree creation because funding-transaction-svc local master and origin/master differed. Read-only Git comparison found local master 0 ahead / 481 behind the existing origin tracking ref; no fetch, reset or checkout occurred. A human must explicitly choose the intended base (local or origin) in Repository branch policy, then retry. Existing worktrees are preserved.

T14 failed its pre-agent PFS baseline. Compile-only `GOPROXY=off GOTOOLCHAIN=local go test -mod=readonly -c -o /tmp/devquest-account-compile.test ./account` in its existing worktree confirmed a missing UpdateLastActivityAccount method in account/mocks.MockIRepository, logrus Error formatting at account/service.go:1132, and a nonconstant fmt.Errorf format at line 1780. Tests were not executed and no repository source files were modified. This diagnosis is attached locally to the blocked task; historical error output remains.

Overview blocker actions now open a diagnostic dialog rather than merely navigating to Tasks. Work cards expose Review blocker and the first diagnostic line. Base-resolution blockers link to branch policy, whose UI now exposes the already-supported local/origin policy. Explicit null can clear a previous policy. Failed validation summaries prioritize stderr so compiler errors do not disappear behind thousands of success lines. Retry and execution guards remain unchanged; no automatic overrides, paid agent starts or task state bypasses.

Browser verified T1 policy dialog and T14 actual compile diagnostics; no policy was saved. Full regression: 380 passed, 2 skipped. Build and syntax checks passed. Evidence: docs/design/evidence/task-base-resolution-dialog.jpg and task-attention-diagnostics.jpg.
