import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hash } from "./store.js";

export const profileRoles = [
  "orchestrator",
  "architect",
  "planner",
  "developer",
  "reviewer",
  "jira-specialist",
];
export const profileSections = [
  "Agent Identity",
  "Mission",
  "Soul — Core Engineering Principles",
  "Technical Expertise",
  "Responsibilities",
  "Supported Workflow Stages",
  "Decision-Making Framework",
  "Input Contract",
  "Output Contract",
  "Tools and Skill Capabilities",
  "Permission Boundaries",
  "Model and Effort Policy",
  "Collaboration and Handoff Rules",
  "Quality Gates",
  "Failure Handling and Escalation",
  "Context and Memory Policy",
  "Observability and Audit Requirements",
  "Explicitly Forbidden Actions",
  "Definition of Done",
];
const check = (ok, message) => {
  if (!ok) throw new Error(`Agent Profile: ${message}`);
};
const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export class AgentProfileRegistry {
  constructor(directory = fileURLToPath(new URL("../agents", import.meta.url))) {
    this.directory = realpathSync(directory);
    this.versions = new Map();
  }
  discover() {
    const ids = new Set();
    return profileRoles.map((role) => {
      const source = path.join(this.directory, `${role}.md`);
      check(realpathSync(source) === source, `unsafe profile symlink: ${role}`);
      check(statSync(source).size <= 64000, `profile exceeds 64KB: ${role}`);
      const content = readFileSync(source, "utf8");
      const front = content.match(/^---\r?\n([\s\S]+?)\r?\n---\r?\n/);
      check(front, `invalid YAML frontmatter: ${role}`);
      const metadata = {};
      // The canonical schema is five flat YAML string scalars; executable/complex YAML is unsupported.
      for (const line of front[1].split(/\r?\n/)) {
        const match = line.match(/^([a-z]+): ([^\r\n]+)$/);
        check(
          match &&
            ["id", "name", "version", "role", "status"].includes(match[1]) &&
            !Object.hasOwn(metadata, match[1]),
          `invalid/duplicate YAML field: ${role}`,
        );
        const value = match[2];
        check(
          !/^[!&*\[\]{|>]/.test(value) && !/[:#]\s/.test(value) && !/["']/.test(value),
          `unsupported YAML scalar: ${role}/${match[1]}`,
        );
        metadata[match[1]] = value;
      }
      check(Object.keys(metadata).length === 5, `missing metadata: ${role}`);
      check(!ids.has(metadata.id), `duplicate ID ${metadata.id}`);
      ids.add(metadata.id);
      check(
        metadata.role === role && metadata.id === `devquest-${role}`,
        `unsupported role/ID mapping: ${role}`,
      );
      check(
        semver.test(metadata.version) && metadata.version.startsWith("1."),
        `invalid/unsupported version: ${role}`,
      );
      check(metadata.status === "proposed", `unsupported definition status: ${role}`);
      const sections = {};
      const headings = [...content.slice(front[0].length).matchAll(/^# (.+)\r?$/gm)];
      const body = content.slice(front[0].length);
      for (const [i, heading] of headings.entries()) {
        check(
          profileSections.includes(heading[1]) && !sections[heading[1]],
          `unknown/duplicate section: ${role}/${heading[1]}`,
        );
        sections[heading[1]] = body
          .slice(heading.index + heading[0].length, headings[i + 1]?.index)
          .trim();
      }
      check(
        profileSections.every((s) => sections[s]),
        `missing required section: ${role}`,
      );
      const digest = hash(content),
        key = `${metadata.id}@${metadata.version}`;
      check(
        !this.versions.has(key) || this.versions.get(key) === digest,
        `content changed without version bump: ${key}`,
      );
      this.versions.set(key, digest);
      return { ...metadata, source, hash: digest, sections };
    });
  }
  pins() {
    return Object.fromEntries(
      this.discover().map((p) => [p.role, { id: p.id, version: p.version, hash: p.hash }]),
    );
  }
  resolve(role, pins) {
    check(profileRoles.includes(role), `unknown profile reference ${role}`);
    const profile = this.discover().find((p) => p.role === role),
      pin = pins?.[role];
    check(
      pin?.id === profile.id && pin.version === profile.version && pin.hash === profile.hash,
      `${role} changed or is unpinned; explicitly re-adopt reviewed profiles while the Quest is idle`,
    );
    return profile;
  }
}

export function profileRole(options) {
  const roles = {
    brainstorm: "architect",
    analysis: "architect",
    trd: "architect",
    spec: "architect",
    plan: "planner",
    task: "developer",
    "v11-task": "developer",
    "v11-fix": "developer",
    "v11-conflict": "developer",
    "v11-target": "developer",
    "commit-message": "developer",
    review: "reviewer",
    "v11-review": "reviewer",
    "v11-route": "orchestrator",
    jira_appendix_generation: "jira-specialist",
    jira_publish: "jira-specialist",
  };
  const role = roles[options.purpose];
  check(role, `unsupported workflow purpose ${options.purpose}`);
  check(
    !options.role ||
      options.role === role ||
      (options.role === "JIRA_APPENDIX" && role === "jira-specialist"),
    `role does not match stage ${options.purpose}`,
  );
  return role;
}
