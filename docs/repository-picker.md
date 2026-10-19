# Repository folder selection

Add Repository and Update Repository Path now offer Browse beside the existing manual path input. Browse opens the macOS folder chooser; Check path validates manual input. The compact preview shows the canonical Git root, repository name, current branch and origin's default branch when its symbolic ref resolves to an existing commit. A nested folder resolves to its repository root. An unavailable default branch is shown as unknown, never guessed from the current branch.

Saving remains disabled until validation succeeds. Editing the input invalidates that preview; saving still independently validates the path. Already-registered canonical roots are blocked, except when checking the same repository during an update. Path updates retain the repository ID, require the same remote and compatible saved worktrees, and refuse running work in any Quest referencing that repository, including secondary-repository design sessions. No source files, worktrees or branches are deleted or modified by selection or preview.

## Security and platform

`PICK_REPOSITORY_FOLDER` and `INSPECT_REPOSITORY_FOLDER` use the existing authenticated typed action API, Host and Origin checks. Picker input cannot supply commands or AppleScript. The only native command is `/usr/bin/osascript` with a fixed `choose folder` script; paths are returned as data, canonicalized and inspected with existing shell-free Git execution. Inspection does not register the path in the backend Git registry or grant agent access. Existing registration, Quest access and worktree policies still apply at save/execution.

One native dialog may be open at a time. It times out after two minutes. Cancellation preserves the input. Native browsing requires macOS and a graphical session; unavailable or failed dialogs leave manual entry and Check path available. The folder dialog runs outside the workflow action queue, so an open chooser does not block Quest actions. Git inspection uses only local refs and makes no network request.

## Verification — 2026-10-15

- `npm test`: 116 tests, 115 passed, one Windows-only skip, zero failed.
- Targeted picker/UI suite: 21 passed; the final full run also covers reliable default-branch detection.
- `npm run check`, Prettier checks and `git diff --check`: passed.
- Native macOS Browse was exercised through the live Add Repository dialog. The selected canonical directory populated the input and displayed a valid Git preview with current/default branches. It was not automatically registered.
- Automated tests mock native selection, cancellation, unavailable dialogs and fixed command execution. Temporary real Git repositories cover nested roots, spaces/special characters, symlinks, duplicate detection, secondary-repository active work, preserved repository IDs and absence of implicit registration. HTTP tests verify authentication and Origin rejection.


## Files changed for this improvement

- `src/folder-picker.js`: fixed native command, cancellation and manual fallback.
- `src/adapters.js`: read-only Git preview and native picker wiring.
- `src/engine.js`: authenticated typed actions, duplicate preview and dependent-Quest update checks.
- `public/app.js`, `public/style.css`: Browse buttons, editable paths, validation preview and save gating.
- `test/folder-picker.test.js`, `test/ui.test.js`: backend, native mocks, HTTP security and UI regression coverage.
- `package.json`: include the new module in syntax checks.
- `docs/repository-picker.md`: usage, safety and verification notes.
