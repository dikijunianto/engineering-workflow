import path from "node:path";
import os from "node:os";
import { constants, openSync, realpathSync, statSync, fstatSync, readSync, closeSync } from "node:fs";
import { profileRole, profileRoles } from "./agent-profiles.js";
import { id, hash } from "./store.js";

export const skillActions = ["INSPECT_SKILL", "REGISTER_SKILL", "UPDATE_SKILL", "ARCHIVE_SKILL", "SET_QUEST_SKILLS"];
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const text = (value, label, max, optional = false) => {
  assert(typeof value === "string" && value.length <= max && (optional || value.trim()), `Invalid ${label}`);
  return value.trim();
};
const list = (value, label) => {
  assert(Array.isArray(value) && value.length <= 30, `Invalid ${label}`);
  return [...new Set(value.map((item) => text(item, label, 160)))];
};

// Registration never grants capabilities; reviewed portable guidance is delivered explicitly.
export class SkillRegistry {
  constructor(engine) { this.e = engine; this.s = engine.store; }
  records() { return this.s.all("settings").filter((item) => item.kind === "registered-skill"); }
  snapshot() {
    return this.records().filter((item) => !item.archived).map((item) => {
      const needs = item.requirements;
      const external = needs.mode === "external" || needs.mcp.length || needs.tools.length || needs.other;
      const reviewed = item.declarationConfirmed && needs.mode !== "unknown" &&
        !(needs.mode === "instructions" && item.sourceHints.length);
      return {
        ...item,
        history: undefined,
        compatibility: Object.fromEntries(["claude", "codex"].map((runtime) => [runtime,
          !item.runtimes.includes(runtime) ? "NOT_ASSESSED" : !reviewed ? "NEEDS_REVIEW" : external ? "REQUIRES_SETUP" : "DECLARED_COMPATIBLE",
        ])),
      };
    });
  }
  async inspect(input) { return this.inspectSource(input).metadata; }
  inspectSource(input) {
    let selected = text(input, "skill path", 4096);
    if (selected === "~" || selected.startsWith("~/")) selected = path.join(os.homedir(), selected.slice(2));
    assert(path.isAbsolute(selected), "Choose an absolute skill folder or SKILL.md path");
    if (statSync(selected).isDirectory()) selected = path.join(selected, "SKILL.md");
    const source = realpathSync(selected);
    assert(path.basename(source) === "SKILL.md", "Select a real SKILL.md file or its folder");
    const file = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let content;
    try {
      const info = fstatSync(file);
      assert(info.isFile() && info.size <= 128 * 1024, "SKILL.md must be a regular file no larger than 128 KB");
      const buffer = Buffer.alloc(128 * 1024 + 1);
      let length = 0;
      while (length < buffer.length) {
        const bytesRead = readSync(file, buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      assert(length <= 128 * 1024, "SKILL.md exceeds 128 KB");
      content = buffer.subarray(0, length).toString("utf8");
      assert(content.trim() && !content.includes("\0"), "SKILL.md must contain readable text");
    } finally { closeSync(file); }
    // Only read simple display metadata. YAML directives are never evaluated.
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] || "";
    const field = (key) => {
      const value = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim() || "";
      return /^[>|]/.test(value) ? "" : value.replace(/^(['"])(.*)\1$/, "$2");
    };
    const detectedMcp = [...new Set([...content.matchAll(/\bmcp__([A-Za-z0-9_-]+)__[A-Za-z0-9_-]+\b/g)].map((match) => match[1]))].slice(0, 30);
    const sourceHints = [
      [/\bmcp\b|mcp__/i, "MCP or external connection references"],
      [/\bBash\b|\bshell\b|\bexec(?:File|Sync)?\b/i, "Shell or command references"],
      [/\b(?:scripts|references|assets)\//i, "Supporting file references"],
      [/\b(?:API[_ -]?KEY|TOKEN|credentials|environment variable)\b/i, "Credential or environment references"],
      [/^(?:allowed-tools|required-tools):/im, "Tool permission declarations"],
      [/\b(?:Claude Code|Codex)\b|\bSkill tool\b/i, "Runtime-specific instruction references"],
    ].filter(([pattern]) => pattern.test(content)).map(([, hint]) => hint);
    if (detectedMcp.length) sourceHints.push(`Named MCP references: ${detectedMcp.join(", ")}`);
    return { content, metadata: {
      path: source, sourceHash: hash(content), sourceHints, detectedMcp,
      name: field("name").slice(0, 100) || path.basename(path.dirname(source)),
      description: field("description").slice(0, 600),
      declaredVersion: field("version").slice(0, 80),
    } };
  }
  resolve(quest, role, runtime) {
    return (quest.skillAssignments?.roles?.[role] || []).map((pin) => {
      const item = this.snapshot().find((entry) => entry.id === pin.id);
      assert(item && item.revision === pin.revision && item.sourceHash === pin.hash,
        "Assigned skill registration changed or was removed; review and reassign it");
      assert(item.compatibility[runtime] === "DECLARED_COMPATIBLE",
        `Skill ${item.name} is not portable guidance for ${runtime}; verify its managed integration first`);
      const source = this.inspectSource(item.path);
      assert(source.metadata.sourceHash === pin.hash, `Skill ${item.name} source changed; inspect and reassign it`);
      return { pin: { ...pin, name: item.name, runtime, status: "GUIDANCE_IN_PROMPT", nativeInvocation: "NOT_VERIFIED" }, content: source.content };
    });
  }
  prepare(quest, options, previous) {
    // Unassigned stages keep their existing native integrations untouched.
    const assigned = Object.values(quest.skillAssignments?.roles || {}).some((pins) => pins.length);
    if (!assigned && !previous?.registeredSkills?.length) return { ...options, registeredSkills: [] };
    const role = profileRole(options);
    const selected = this.resolve(quest, role, options.runtime);
    const pins = selected.map((entry) => entry.pin);
    if (previous) assert(JSON.stringify((previous.registeredSkills || []).map(({ source, ...pin }) => pin)) === JSON.stringify(pins),
      "Assigned skills changed since this AgentRun; start a fresh reviewed run");
    const receipts = selected.map((entry) => ({ ...entry.pin, source: this.s.agentContext(entry.content) }));
    const guidance = selected.map((entry) => `\nRegistered guidance: ${entry.pin.name} (${entry.pin.hash})\n${entry.content}\nEnd registered guidance.\n`).join("");
    return { ...options, registeredSkills: receipts, prompt: String(options.prompt || "") +
      (guidance ? "\nSUPPLEMENTAL GUIDANCE: stage contracts, permissions and approvals remain authoritative. No new tools or access are granted.\n" + guidance : "") };
  }
  async action(type, p) {
    if (type === "SET_QUEST_SKILLS") {
      const quest = this.e.get("quests", p.questId);
      assert(profileRoles.includes(p.role), "Choose a supported agent role");
      assert(p.role !== "jira-specialist", "Jira Specialist uses its dedicated managed skill integration");
      assert(!this.s.all("runs").some((run) => run.questId === quest.id && ["RUNNING", "WAITING_INPUT", "PAUSED", "INTERRUPTED"].includes(run.state)),
        "Finish agent sessions before changing skill assignments");
      assert(p.expectedRevision === (quest.skillAssignments?.revision || 0), "Skill assignments changed; refresh first");
      assert(Array.isArray(p.skills) && p.skills.length <= 5, "Select at most five skills per role");
      assert(new Set(p.skills.map((pin) => pin.id)).size === p.skills.length, "Duplicate skill assignment");
      const pins = p.skills.map((pin) => ({ id: pin.id, revision: pin.revision, hash: pin.hash }));
      const roles = { ...quest.skillAssignments?.roles, [p.role]: pins };
      const updated = { ...quest, skillAssignments: { revision: (quest.skillAssignments?.revision || 0) + 1, roles } };
      for (const pin of pins) {
        const item = this.snapshot().find((entry) => entry.id === pin.id);
        assert(item && Object.values(item.compatibility).includes("DECLARED_COMPATIBLE"), "Only reviewed portable guidance can be assigned");
        this.resolve(updated, p.role, item.runtimes[0]);
      }
      this.s.put("quests", updated);
      return updated.skillAssignments;
    }
    if (type === "INSPECT_SKILL") return this.inspect(p.path);
    const previous = type !== "REGISTER_SKILL" ? this.records().find((item) => item.id === p.skillId) : null;
    assert(type === "REGISTER_SKILL" || previous && !previous.archived, "Registered skill not found");
    if (previous) assert(p.revision === previous.revision, "Skill registration changed; refresh before editing");
    if (type === "ARCHIVE_SKILL") {
      this.s.put("settings", { ...previous, archived: true, updatedAt: new Date().toISOString() });
      return { archived: true };
    }
    const source = await this.inspect(p.path);
    assert(p.sourceHash === source.sourceHash, "Skill source changed or was not inspected; inspect it before saving");
    assert(!this.records().some((item) => !item.archived && item.id !== previous?.id && item.path === source.path), "Skill already registered; edit its requirements instead");
    assert(previous || this.records().filter((item) => !item.archived).length < 100, "Skill registry is limited to 100 active entries");
    const runtimes = list(p.runtimes, "runtime declarations");
    assert(runtimes.every((runtime) => ["claude", "codex"].includes(runtime)), "Unsupported skill runtime");
    const needs = p.requirements;
    assert(needs && ["unknown", "instructions", "external"].includes(needs.mode), "Choose a requirements category");
    const requirements = {
      mode: needs.mode, mcp: list(needs.mcp, "MCP requirements"), tools: list(needs.tools, "tool requirements"),
      other: text(needs.other, "other requirements", 2000, true),
    };
    assert(requirements.mode !== "instructions" || !(requirements.mcp.length || requirements.tools.length || requirements.other), "Instructions-only skills cannot declare external requirements");
    assert(requirements.mode !== "external" || requirements.mcp.length || requirements.tools.length || requirements.other, "Describe the required MCP, tools or setup");
    assert(typeof p.declarationConfirmed === "boolean", "Confirm whether requirements were reviewed");
    const record = {
      ...source, id: previous?.id || `skill:${id()}`, kind: "registered-skill",
      name: text(p.name || source.name, "skill name", 100),
      description: text(p.description ?? source.description, "skill description", 600, true),
      runtimes, requirements, declarationConfirmed: p.declarationConfirmed,
      revision: (previous?.revision || 0) + 1, updatedAt: new Date().toISOString(),
      history: previous ? [...previous.history, { ...previous, history: undefined }] : [],
    };
    this.s.put("settings", record);
    return this.snapshot().find((item) => item.id === record.id);
  }
}
