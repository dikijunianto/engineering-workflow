> Superseded by the actual WebGL pipeline redesign in [engineering-diorama.md](engineering-diorama.md). Retained as historical validation evidence.

# Agent Worktrees — reviewed implementation slice

Date: 2026-10-22. Status: implemented locally; awaiting visual review before extending other tour stages.

## What changed

The original Agent Worktrees view used rotating wireframe cubes and an octahedron, with adjacent workflow stations partially outside the viewport. It repeated stage and tour numbering, labeled illustrated roles as active engines, and displayed several dense documentation panels. Its canvas scheduled frames continuously.

The replacement shows an approved plan document feeding three developer workbenches, a single integration queue, and an independent review desk. Solid projected geometry uses SVG; it needs no WebGL context, 3D library, model downloads, textures, or additional dependency.

- Stable illustrative identities: T-01 / DEV-A, T-02 / DEV-B, T-03 / DEV-C; REV-A reviews the integrated result.
- Five selectable handoffs: approved plan, isolated worktrees, task execution, integration queue, independent review.
- Each selection highlights the relevant object and updates one concise semantic HTML explanation and artifact identity.
- Explicit “Illustration · no live agents” label. No simulated progress, worker telemetry, or fabricated active session counts.
- Optional technical details and always-present human approval guidance.
- Separate scene controls, workflow navigation, and “Open Agents” application navigation.
- Camera changes finish in 260 ms; yaw, pitch, and zoom are bounded. Reset works repeatedly. No perpetual animation loop in this slice.
- Labels are drawn above geometry, fitted to the scene, and placed without collisions within the tested camera bounds.
- At 600 px and below, the component selects a readable 2D flow with inline selected explanations. Missing SVG support also selects the HTML fallback. Desktop users may choose 2D manually.
- Keyboard: Tab reaches controls/objects; Enter or Space selects objects; arrows orbit the focused scene; +/- zoom; R or Home resets. Tour tabs use Left/Right/Home/End, maintain focus, and reveal the selected tab on narrow screens.
- Reduced motion immediately applies camera changes and disables object opacity transitions.

Shared tour shell changes are limited to shorter title, unnumbered stage tabs, keyboard behavior, selected-tab visibility, manual tour default, and pausing auto-tour for this slice/reduced-motion preference. Other stage scenes and their copy remain for later review.

## Screenshots

- [Before — actual app, 981 × 969](evidence/worktrees/before.png)
- [After — actual app, matched 981 × 969](evidence/worktrees/after.png)
- [After — actual app, 1280 × 720](evidence/worktrees/after-desktop.png)
- [After — actual app, 390 × 680](evidence/worktrees/after-narrow.png)

## Browser evidence

Used the actual DevQuest app at localhost:4310 and an isolated production-mode component fixture at localhost:4318. The fixture has no workflow API, no account access, and no execution actions. Narrow testing was also repeated against the actual application using a browser viewport override, which was reset afterward.

| Check | Observed result |
| --- | --- |
| Pointer orbit | Drag changed camera from yaw -0.100 / pitch 0.850 to yaw 0.110 / pitch 0.940; pitch stopped at its bound. |
| Zoom | Two zoom-in clicks reached 1.180; zoom-in disabled at maximum. |
| Keyboard | Scene arrows changed camera without leaving Agent Worktrees; minus zoomed; R restored -0.220 / 0.850 / 1.000. Enter selected the review object. |
| Reset | Keyboard reset and repeated button reset restored the same default camera. |
| Selection | Plan, worktrees, execution, integration and review updated their corresponding explanation and selected state. Direct object selection also worked. |
| Framing | Browser bounding-box checks at maximum zoom found zero clipped labels and zero label intersections. Automated projection checks cover 45 yaw/pitch/zoom combinations. |
| Tour navigation | Left moved focus and selection from Agent Worktrees to Jira Appendix; Right returned to Agent Worktrees. No application action was invoked. |
| Narrow viewport | At 390 × 680, no horizontal page overflow. Dialog bounds: x 10.5–379.5; footer bottom 651.8, inside viewport. Selected tab remains visible after resize. |
| 2D fallback | Missing-SVG fixture automatically selected 2D and disabled the 3D control. Selecting independent review still updated the explanation. |
| Reduced motion | A controlled matchMedia fixture returned reduce=true. Review selection immediately produced camera 0.220 / 0.850 / 1.000; computed opacity transition duration was 0s. The OS setting itself was not changed. |
| Console | No warning/error entries observed during final actual-app inspection. |

## Performance findings

[Raw measured evidence](evidence/worktrees/performance.json).

- Final isolated fixture, 1280 × 720: load event at **241.9 ms**; uncompressed fixture JavaScript 351,128 bytes, loaded in 15.8 ms on localhost. This is a component preview, not a whole-app cold-load benchmark.
- The instrumented page recorded a **121 ms startup long task**. Earlier runs varied (including no long tasks and an 86 ms startup task). Startup is not claimed to be free of jank.
- The 95th percentile synchronous RAF callback time was **0.1 ms**. This measures the callback only; React commit, layout and paint are excluded, so it is not a frame-rate or total-render-time claim.
- Idle page-wide RAF counts stayed unchanged between separated observations (307 → 307 in the interaction run). Camera animation is scheduled only while a transition is in progress. Page-wide counts include browser automation, so raw callback counts are not presented as application-only frame counts.
- Actual dashboard bundle: **599,436 bytes**, versus **582,770 bytes** at task start: **+16,666 bytes**. CSS: **57,630 bytes**, versus **51,443 bytes**: **+6,187 bytes**. Figures are minified, uncompressed output; no new dependency was added.
- GPU time, device memory, battery use, a sustained FPS benchmark, and low-end physical devices were not measured.

## Tests

- `npm run build:ui`: passed.
- `npm run check`: passed.
- Full `npm test`: **365 passed, 2 skipped**, 367 total.
- After the final UI/framing changes: `node --test test/worktrees-diorama.test.js test/dashboard.test.js test/ui.test.js`: **75 passed**, zero failures.
- New tests cover stable task/agent identities, five handoffs, 45 bounded-camera combinations, geometry/label framing, label collisions, simulation semantics, safety explanation and navigation/control separation.

## Reusable visual pattern

1. **Artifact → workspace → handoff.** Use objects that represent documents, task workspaces, queues and review evidence. Connect them with directional paths.
2. **One selection, one explanation.** A small handoff definition supplies title, short purpose, artifact identity and optional technical detail. The same selection controls the model, HTML explanation and 2D fallback.
3. **Persistent identities.** Labels remain stable across scene states; never derive demonstration identities from live AgentRuns.
4. **Bounded camera and labels.** Fit the whole scene within explicit world bounds. Animate only toward user-requested camera targets, and reserve screen space for labels.
5. **Three control regions.** Scene manipulation above the diorama, handoff selection beside/below it, tour navigation in the fixed footer. Actual app navigation is separately labeled.
6. **Progressive presentation.** Preserve semantic explanation independently of the graphic. Use the same handoff data in the compact HTML fallback; honor reduced motion.

This is a pattern for the remaining stages, not a new scene framework. Extend it only after this slice is reviewed.

## Files and scope

- `ui/worktrees-scene.js`: handoff data, stable sample identities, bounded projection and label placement.
- `ui/worktrees-diorama.jsx`: solid SVG scene, controls, explanatory panel and HTML fallback.
- `ui/onboarding-3d.jsx`: selects this component only for Agent Worktrees; small shared-shell accessibility changes.
- `ui/styles.css`: scoped scene and responsive styles.
- `public/dashboard.js`, `public/dashboard.css`: rebuilt assets.
- `test/worktrees-diorama.test.js`: regression coverage.
- This document and screenshot/measurement evidence.

Pre-existing uncommitted dashboard, project-detail and onboarding work was preserved. No backend workflow code, Quest state, Jira data, agent execution, repository permissions, installed skills or paid model calls were changed. No commits or pushes were made.

The running application already displayed “Restart required” and a loading overview before this task. The tour was inspected through its working navigation entry; the backend was not restarted and that separate issue was not investigated here. Other onboarding stages retain their existing visuals and runtime behavior. Physical-device and assistive-technology audits remain outside this slice's verification.
