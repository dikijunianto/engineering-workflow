# Jira Tasks — Weight Point Calculation (≤ 8 pt per task, target)

**Project:** `synthetic-service` (`development` branch)
**Scope:** Approved plan Task A
**Reference appendix:** Choose Appendix (v3)
**Generated:** 2026-10-17
**Rule:** Each Task target ≤ 8 weight points.

## 1. Appendix reference (weight matrix)

**Source:** Jira project `FFE` · field `Choose Appendix (v3)` (`customfield_11543`) · fetched `2026-10-17` via `getJiraIssueTypeMetaWithFields` (synthetic fixture, no live call).
**Weight resolution:** inferred from MOB-V/L/M/H prefix.

| Weight | Categories (label · Jira option id) |
|-------:|------------|
| **2 pt** | `Refactor or add 1 generic function` (`11515`); `Refactor generic function unit test` (`11516`) |

## 2. Categorization heuristics

| Codebase pattern | Appendix line | Weight | Note |
|---|---|---:|---|
| Helper function | Refactor or add 1 generic function | 2 | |
| Helper unit test | Refactor generic function unit test | 2 | |

## 3. Tasks (each ≤ 8 pt, target)

### Phase Group 1 — Alpha change

#### T1.1 — Alpha change
| Appendix line | Category | Weight |
|---|---|---:|
| Add Alpha helper from approved plan Task A | Refactor or add 1 generic function | 2 |
| Write Alpha helper unit test from approved plan Task A | Refactor generic function unit test | 2 |
| **Task total** | | **4** |

**Notes**
- Source: `plan.md`, Task A. Acceptance criteria: helper returns the expected result.
- Depends on: none. Affected repositories: synthetic-service.
- Implementation scope: approved helper. Testing requirements: helper unit test.

**Phase Group 1 subtotal: 4 pt (1 tasks)**

## 4. Grand total

| Phase Group | Tasks | Subtotal |
|---|---:|---:|
| 1 — Alpha change | 1 | 4 |
| **GRAND TOTAL** | **1** | **4** |

Average task weight: **4 pt** · Max task weight: **4 pt** · Min task weight: **4 pt**

## 5. Weight distribution (per-task)

| Task weight | Count | % of total tasks |
|---:|---:|---:|
| 4 | 1 | 100% |

0 tasks exceed the ≤ 8 pt target.

## 6. Open items / known gaps

### 6.1 Tasks exceeding 8 pt (recommended re-splits)
No tasks exceed 8 pt.

### 6.2 Categorization caveats
No categorization caveats.

### 6.3 Test scoring
Unit test: 2 pt according to the synthetic matrix; bundled with implementation.

### 6.4 Other carryover gaps
None.

### 6.5 Excluded plan steps (audit trail per Iron Rule #6)
None — plan contained no boilerplate steps.

## 7. Suggested Jira import format

For each Task above:
- **Issue type:** Task
- **Summary:** task title
- **Description:** copy the appendix-line table verbatim
- **Custom field "Weight Point":** task total
- **Custom field "Phase Group":** section header

**Total to create (1:1 with this file):** 1 Task issues.
