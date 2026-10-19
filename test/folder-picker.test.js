import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, realpath, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { FolderPicker } from "../src/folder-picker.js";
import { fixture } from "./engine-fixture.js";
import { createServer } from "../src/server.js";

test("native picker uses one fixed command, canonicalizes special-character paths and handles cancellation/unavailability", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devquest picker "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = path.join(root, 'repo $() `test` "quoted" & spaces');
  await mkdir(folder);
  const alias = path.join(root, "alias");
  await symlink(folder, alias, "dir");
  const calls = [];
  const picker = new FolderPicker({
    platform: "darwin",
    runner: async (...args) => {
      calls.push(args);
      return { code: 0, stdout: `${alias}/\n`, stderr: "" };
    },
  });
  assert.deepEqual(await picker.choose(), { path: await realpath(folder) });
  assert.equal(calls[0][0], "/usr/bin/osascript");
  assert.deepEqual(calls[0][1].slice(0, 1), ["-e"]);
  assert.equal(calls[0][1].length, 2);
  assert.match(calls[0][1][1], /choose folder/);
  assert.ok(!calls[0][1][1].includes(folder));
  picker.runner = async () => ({ code: 0, stdout: "\n" });
  assert.deepEqual(await picker.choose(), { cancelled: true });
  picker.runner = async () => {
    throw new Error("ENOENT");
  };
  assert.equal((await picker.choose()).unavailable, true);
  const unsupported = new FolderPicker({
    platform: "linux",
    runner: () => assert.fail("must not execute"),
  });
  assert.equal((await unsupported.choose()).unavailable, true);
});

test("folder inspection prefers Git roots, catches aliases/duplicates, and never registers selections", async (t) => {
  const f = await fixture(t, { realGit: true });
  const root = path.join(f.dir, "unregistered repo with spaces & $()");
  await mkdir(root);
  execFileSync("git", ["init", "-b", "main"], { cwd: root, stdio: "ignore" });
  const nested = path.join(root, "nested");
  await mkdir(nested);
  const alias = path.join(f.dir, "selected alias");
  await symlink(nested, alias, "dir");
  const initial = f.store.all("repositories").length;
  f.adapters.folderPicker = { choose: async () => ({ path: alias }) };
  const result = await f.engine.action("PICK_REPOSITORY_FOLDER");
  assert.equal(result.valid, true);
  assert.equal(result.path, await realpath(root));
  assert.equal(result.currentBranch, "main");
  assert.equal(result.defaultBranch, null);
  assert.equal(f.store.all("repositories").length, initial);
  await assert.rejects(
    f.adapters.git.prepare({
      repoPath: root,
      path: path.join(f.dir, "unauthorized"),
      branch: "test/picker",
    }),
    /not registered/,
  );
  f.adapters.folderPicker.choose = async () => ({ cancelled: true });
  assert.deepEqual(await f.engine.action("PICK_REPOSITORY_FOLDER"), {
    cancelled: true,
  });
  const duplicate = await f.engine.action("INSPECT_REPOSITORY_FOLDER", {
    path: f.repos[0].path,
  });
  assert.equal(duplicate.valid, false);
  assert.equal(duplicate.registeredId, f.repos[0].id);
  execFileSync(
    "git",
    ["update-ref", "refs/remotes/origin/development", "HEAD"],
    { cwd: f.repos[0].path },
  );
  execFileSync(
    "git",
    [
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/development",
    ],
    { cwd: f.repos[0].path },
  );
  const defaultBranch = await f.engine.action("INSPECT_REPOSITORY_FOLDER", {
    path: f.repos[0].path,
  });
  assert.equal(defaultBranch.defaultBranch, "development");
  assert.match(duplicate.error, /already registered/);
  const invalid = await f.engine.action("INSPECT_REPOSITORY_FOLDER", {
    path: f.dir,
  });
  assert.equal(invalid.valid, false);
  assert.match(invalid.error, /valid Git repository/);
  await assert.rejects(
    f.engine.action("PICK_REPOSITORY_FOLDER", { command: "touch forbidden" }),
    /Unsupported.*parameter/,
  );
});

test("path updates reject running secondary-repository Quest dependencies and preserve IDs", async (t) => {
  const f = await fixture(t, { realGit: true });
  const secondary = f.repos[1];
  execFileSync(
    "git",
    ["remote", "add", "origin", "https://example.test/project.git"],
    { cwd: secondary.path },
  );
  f.store.put("repositories", {
    ...secondary,
    remote: "https://example.test/project.git",
  });
  await f.engine.action("ANALYZE_PRD", {
    questId: f.quest.id,
    runtime: "claude",
  });
  assert.equal(f.pending[0].options.cwd, f.repos[0].path);
  const preview = await f.engine.action("INSPECT_REPOSITORY_FOLDER", {
    repositoryId: secondary.id,
    path: secondary.path,
  });
  assert.equal(preview.valid, false);
  assert.equal(preview.referencedQuests, 1);
  assert.match(preview.error, /dependent Quest/);
  await assert.rejects(
    f.engine.action("UPDATE_REPOSITORY", {
      repositoryId: secondary.id,
      path: secondary.path,
    }),
    /active agent process/,
  );
  await f.finish("Repository impact examined");
  const updated = await f.engine.action("UPDATE_REPOSITORY", {
    repositoryId: secondary.id,
    path: secondary.path,
  });
  assert.equal(updated.id, secondary.id);
  assert.deepEqual(
    f.store.get("quests", f.quest.id).repositoryIds,
    f.quest.repositoryIds,
  );
});

test("native dialog cannot hold the workflow queue and typed picker actions require local authentication", async (t) => {
  const f = await fixture(t);
  let finishDialog;
  f.adapters.folderPicker = {
    choose: () =>
      new Promise((resolve) => {
        finishDialog = resolve;
      }),
  };
  const selection = f.engine.action("PICK_REPOSITORY_FOLDER");
  await f.engine
    .action("SAVE_CHECKPOINT", { runId: "missing", summary: "test" })
    .catch((error) => assert.match(error.message, /record not found/));
  finishDialog({ cancelled: true });
  await selection;
  let calls = 0;
  const app = await createServer({
    port: 0,
    dataDir: path.join(f.dir, "http"),
    adapters: {
      config: {},
      runtimes: {},
      git: {},
      folderPicker: {
        choose: async () => {
          calls++;
          return { cancelled: true };
        },
      },
    },
  });
  t.after(() => app.close());
  const send = (headers) =>
    fetch(`${app.url}/api/action`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ type: "PICK_REPOSITORY_FOLDER" }),
    });
  assert.equal((await send({})).status, 403);
  const { token } = await (await fetch(`${app.url}/api/session`)).json();
  assert.equal(
    (
      await send({
        "x-devquest-token": token,
        origin: "https://outside.example",
      })
    ).status,
    403,
  );
  assert.equal(calls, 0);
  assert.equal((await send({ "x-devquest-token": token })).status, 200);
  assert.equal(calls, 1);
});
