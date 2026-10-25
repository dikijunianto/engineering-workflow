# DevQuest interface system

Professional engineering workspace with subtle mission identity. The DevQuest sword,
project flag and six named agent roles carry the RPG character. Operational screens
use restrained neutral surfaces, local vector icons and actual state; no artwork,
remote fonts, placeholder activity or decorative dashboard statistics.

## Foundation

The existing browser module, hash routes, template helpers and delegated handlers
remain. No UI framework or dependency was added. `public/style.css` owns the system:

- Canvas `#09090b`, navigation `#101012`, surface `#18181b`, raised/border `#27272a`.
- Primary text `#eceeea`, secondary `#c4c9c3`, muted `#a1a8b0`.
- Emerald action/focus accent `#34d399`; dark text on accent `#09090b`.
- Essential control boundary `#6b737c`; decorative dividers remain quieter.
- Success, warning, danger and information use the existing green/amber/red/slate
  palette. An explicit display-only status map replaces heuristic success defaults.
  Unknown states are neutral. Text and distinct symbols supplement color.
- System UI sans; SFMono/Menlo/Consolas for identifiers and technical output.
  Shared title/heading/body/small/caption tokens: 24/16/14/13/12px.
- Spacing tokens: 4/8/12/16/24/32/48px. Radius: 8px surfaces, 6px control token,
  4px badges. Default/compact buttons have 36/32px minimum heights, increasing to
  40/36px on phone. Existing native field sizing and visible focus remain.
- Dark mode only. Existing reduced-motion suppression remains in force.

Input boundary contrast is approximately 3.70:1 against the input background;
muted text is approximately 6.89:1 against the panel. These measured pairs are not
a certification of every component or assistive-technology combination.

## Operational patterns

- Project header: actual project breadcrumb, exact substage and familiar five
  workflow groups. On phone, the full stage list is an explicit disclosure.
- Project Overview: next action precedes compact Jira generation/verification
  notices. Full errors and exact model/skill details remain available. No success
  message grants approval or enables publication.
- Agents: current/needs-input rows first; all previous runs remain in history.
  Expand an individual run to see output, scope, provenance, progress and the
  original permitted controls. Runs are collapsed initially; this starts no agent.
  Six-role roster and runtime connections are secondary disclosures.
- Work: stable task disclosures with state in each summary; expanding reveals
  dependencies, validation and the existing controls. No task scheduling changes.
- Documents: keep collapse/viewer/source/download, original Markdown and exact
  artifact revision approval. Prose is readable; tables/code may scroll locally.
- Repositories: separate Status, Works and Actions columns. The registry scrolls
  locally on a narrow screen; Browse/manual entry and validation remain unchanged.
- Settings: Workspace, Agents & skills and Integrations group the existing forms.
  Save scopes, inherited defaults, readiness checks and integration policy remain.
- Room/Skills/empty states use the same controls, headings, spacing and status
  presentation. No automatic message delivery, skill activation or execution.

## Accessibility and interactions

Navigation uses real links and `aria-current`. The narrow navigation disclosure
uses `aria-expanded`/`aria-controls`, and Escape closes it. Native dialogs are named
by their heading and describe general form errors. Native Escape/focus return is
preserved. Same-route refresh preserves named form-field/disclosure focus as well
as the existing drafts, selections, scroll and document expansion behavior.

Do not replace link navigation with incomplete ARIA tabs or remove native
keyboard behavior. Error reasons must be readable rather than hover-only.

## Icons and obsolete artwork

25 Lucide glyphs are vendored as a local SVG sprite. Geometry is unchanged; the
outer SVG becomes a symbol and inherits the common wrapper stroke. The sword uses
the same verified family. No unrelated icon families or proprietary logos are used.

See [asset provenance](asset-provenance.json) for exact source commit, URLs, hashes,
author, license and modifications. Full ISC and applicable Feather MIT notices are
retained in `public/icons/LICENSE-lucide.txt`. Fixed server asset routes serve only
the sprite and notice. No generic file-serving or command endpoint was added.

The unused 1.5MB landscape and obsolete asset README were removed from shipped
files along with the old static route/test expectation. The image is recoverable
from Git history and a local audit archive. No source repository/worktree content
was deleted.

## Verification and limits

Regression tests cover typed action payloads, exact revision approvals, independent
review and runtime policies, new native disclosures, known/unknown statuses,
navigation Escape, dialog naming and pinned icon provenance.

Browser evidence uses actual live empty views and a labeled, GET-only historical
viewer for populated views because the three saved projects are deleted. Original
projects were not restored. Pilot captures cover 1440/1280/768/390 CSS pixels;
repository/settings phone and document/task/run detail checks supplement them.
No paid agents, real Jira operations, commits, pushes or PRs are needed for this work.
Full screen-reader/platform conformance remains a separate verification task.

## React Overview

Overview and header controls use React, Tailwind CSS 4, Lucide React and local
shadcn/ui components (MIT, license in ui/components/LICENSE-shadcn.txt). Components
were imported from the official new-york registry, with local utility imports and
active tab styling adapted. Existing workflow screens continue to use the legacy
renderer. CSS layers keep Tailwind utilities above the legacy screen rules without
introducing a global reset.

Run `npm run build:ui` after editing ui/; `npm start` builds automatically. The
fixed dashboard JavaScript/CSS assets are served locally under the existing CSP.
The build fingerprint includes both generated assets, so server restart detection
continues to protect typed actions.

Metrics use saved data. Weekly trends and code-diff statistics are not recorded,
so these show unavailable rather than invented numbers. Sample cards are opt-in,
clearly labeled and cannot start work. Archived maps to recoverable Deleted
projects, with restore available in the existing project list. Search is local,
Cmd/Ctrl+K opens its dialog, and the avatar represents the local workspace. Quick
Actions open setup flows without authorizing execution or Jira publishing.

The React sidebar groups Workspace, AI Engine, Integration and System. Settings
and the connection footer sit at the bottom on desktop; the mobile menu retains
all groups. Project and repository badges use saved counts; the Agents dot appears
only for running sessions. The footer tracks the local event-stream connection,
reports stale backends as requiring restart, and displays the actual package
version. It does not assert provider readiness. All routes share a sticky 56px
header, 20px semibold page titles and emerald primary actions.

## Create Project dialog

React/shadcn dialog with Project Details, Jira & Sync and AI Execution Settings
tabs. The content is limited to 85vh; only the middle body scrolls, and the
header/close control and submit footer remain visible. Inactive panels stay
mounted so values survive tab changes; invalid fields select the correct tab.
Repository pills retain native checkbox semantics and keyboard focus. The
default routing choice disables overrides, preserving existing creation defaults.
Custom routing lists verified permitted models and excludes Fable.

The modal and basic fallback call the same createProject function and typed
CREATE_QUEST action. Existing file/Confluence imports, QA issue linking, stored
BE weights, model/effort settings, review handoff and explicit PR consent remain.
Creation starts no agents and never publishes Jira issues. FE is visibly disabled
because the existing Jira integration accepts only BE, MOB and ALL; that backend
contract is unchanged.

Validation: synthetic local browser submission, required QA issue validation across
tabs, repository pill toggling, default/custom routing, working close control and
390x600 viewport (510px modal, independent body scrolling, visible footer). Full
regression suite: 351 passed, 2 skipped. Real workspace test opens/cancels only.

## Agents dashboard

The Agents React screen shares the Overview grid, primitives and zinc/emerald
theme. All six roles remain visible; their mappings use saved project overrides
or explicitly say inherited policy. Running sessions remain visible even if a
later attempt exists. Latest waiting/failed/paused sessions appear separately,
with full history preserved. Runtime progress is indeterminate because the CLI
does not report a reliable percentage.

View Logs opens the existing run renderer in the native dialog, retaining pause,
continue, checkpoint, access and profile evidence and agent instructions. Logs
stream live; refresh preserves unsent instructions. Terminate requires confirmation
and uses INTERRUPT_AGENT or CANCEL_APPENDIX, preserving worktrees and history.
Connection tests use the existing CHECK_READINESS action (CLI/login/model policy;
no inference). Runtime badges distinguish installed CLI capability from verified
login, native/logical resume and nested-agent restrictions. No version, login or
provider entitlement is invented.

Configure and Run Standalone open a project-scope chooser. Configure leads to
existing project settings; Launch leads to the next eligible project action and
its existing approval flow. This UI does not introduce unrestricted standalone
execution or authorize a paid run.
