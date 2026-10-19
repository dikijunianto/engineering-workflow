import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRepositoryReader } from "../src/repository-reader.js";
import { CodexRuntime } from "../src/adapters.js";

async function scope(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "devquest read tool "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repos = [];
  for (const name of ["finance", "funding", "unselected"]) {
    const folder = path.join(root, name);
    await mkdir(folder);
    await writeFile(path.join(folder, "README.md"), `Harmless ${name}`);
    repos.push({ id: name, name, path: folder });
  }
  return {
    root,
    repos,
    readOnly: true,
    cwd: repos[0].path,
    repositories: repos.slice(0, 2),
  };
}
async function rpc(url, method, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  assert.equal(response.status, 200);
  return (await response.json()).result;
}
test("scoped repository tool reads selected roots only and exposes no shell/write API", async (t) => {
  const s = await scope(t),
    reader = await createRepositoryReader(s);
  t.after(() => reader.close());
  const listed = await rpc(reader.url, "tools/list");
  assert.equal(listed.tools[0].annotations.readOnlyHint, true);
  assert.deepEqual(
    listed.tools.map((tool) => tool.name),
    ["ReadRepositoryFile"],
  );
  for (const repo of s.repositories) {
    const result = await rpc(reader.url, "tools/call", {
      name: "ReadRepositoryFile",
      arguments: { repoId: repo.id, path: "README.md" },
    });
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /Harmless/);
  }
  await symlink(
    path.join(s.repos[2].path, "README.md"),
    path.join(s.repos[0].path, "escape.md"),
  );
  for (const args of [
    { repoId: "finance", path: ".." },
    { repoId: "finance", path: "../unselected/README.md" },
    { repoId: "unselected", path: "README.md" },
    { repoId: "finance", path: path.join(s.root, "unselected", "README.md") },
    { repoId: "finance", path: "escape.md" },
  ]) {
    const result = await rpc(reader.url, "tools/call", {
      name: "ReadRepositoryFile",
      arguments: args,
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Access denied/);
  }
  assert.equal(
    (
      await rpc(reader.url, "tools/call", {
        name: "Write",
        arguments: { repoId: "finance", path: "README.md" },
      })
    ).isError,
    true,
  );
  assert.equal(
    (
      await fetch(reader.url.replace(/\/[a-f0-9]+$/, "/wrong"), {
        method: "POST",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(reader.url, {
        method: "POST",
        headers: { Origin: "http://evil.invalid" },
      })
    ).status,
    403,
  );
});
test("Codex scoped adapter invokes actual reader interface, preserves sandbox and denies a skipped repository", async (t) => {
  const s = await scope(t),
    calls = [],
    events = [];
  let skip = false;
  const runtime = new CodexRuntime({
    runner: async (_file, args, options) => {
      calls.push({ args, input: options.input });
      const setting = args.find((arg) => arg.startsWith("mcp_servers="));
      const url = JSON.parse(setting.match(/url=("[^"]+")/)[1]);
      for (const repo of s.repositories.slice(0, skip ? 1 : 2))
        await rpc(url, "tools/call", {
          name: "ReadRepositoryFile",
          arguments: { repoId: repo.id, path: "README.md" },
        });
      return {
        code: 0,
        stderr: "",
        stdout:
          JSON.stringify({
            type: "item.completed",
            item: { type: "agent_message", text: "Read-only TRD" },
          }) + "\n",
      };
    },
  });
  runtime.help = "--ignore-user-config";
  runtime.detectCapabilities = async () => ({
    available: true,
    nestedRestriction: true,
  });
  await runtime.start({
    cwd: s.cwd,
    readOnly: true,
    accessScope: s,
    onEvent: (event) => events.push(event),
  });
  assert.equal(
    events.filter((event) => event.type === "repository-tool").length,
    2,
  );
  const args = calls[0].args;
  assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
  assert.ok(!args.includes("--add-dir"));
  assert.ok(args.includes("--ignore-user-config"));
  assert.match(
    args.find((arg) => arg.startsWith("mcp_servers=")),
    /enabled_tools=\["ReadRepositoryFile"\].*ReadRepositoryFile=\{approval_mode="writes"\}/,
  );
  assert.ok(args.includes("code_mode_host"));
  for (const feature of [
    "shell_tool",
    "unified_exec",
    "code_mode",
    "computer_use",
    "multi_agent",
  ])
    assert.ok(args.includes(feature));
  assert.match(calls[0].input, /EVERY selected repository/);
  skip = true;
  await assert.rejects(
    runtime.start({ cwd: s.cwd, readOnly: true, accessScope: s }),
    /skipped a selected repository/,
  );
});
