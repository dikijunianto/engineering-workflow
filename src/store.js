import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";

export const id = () => randomUUID();
export const hash = (value) => createHash("sha256").update(value).digest("hex");
const tables = new Set([
  "repositories",
  "quests",
  "tasks",
  "works",
  "runs",
  "artifacts",
  "approvals",
  "events",
]);

export class Store {
  constructor(dir) {
    this.dir = path.resolve(dir);
    mkdirSync(this.dir, { recursive: true });
    this.db = new DatabaseSync(path.join(this.dir, "devquest.db"));
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    for (const table of tables)
      this.db.exec(
        `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)))`,
      );
    this.db
      .exec(`CREATE UNIQUE INDEX IF NOT EXISTS work_identity ON works(json_extract(data,'$.questId'),json_extract(data,'$.repoId'));
      CREATE UNIQUE INDEX IF NOT EXISTS repository_path ON repositories(json_extract(data,'$.path'));
      CREATE UNIQUE INDEX IF NOT EXISTS active_repo_run ON runs(json_extract(data,'$.workId'))
        WHERE json_extract(data,'$.state') IN ('RUNNING','WAITING_INPUT','PAUSED','INTERRUPTED') AND json_extract(data,'$.workId') IS NOT NULL;`);
  }
  table(name) {
    if (!tables.has(name)) throw new Error("Unknown record type");
    return name;
  }
  all(table) {
    return this.db
      .prepare(`SELECT data FROM ${this.table(table)} ORDER BY rowid`)
      .all()
      .map((row) => JSON.parse(row.data));
  }
  get(table, key) {
    const row = this.db
      .prepare(`SELECT data FROM ${this.table(table)} WHERE id=?`)
      .get(key);
    return row ? JSON.parse(row.data) : null;
  }
  put(table, value) {
    this.db
      .prepare(
        `INSERT INTO ${this.table(table)}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
      )
      .run(value.id, JSON.stringify(value));
    return value;
  }
  remove(table, key) {
    this.db.prepare(`DELETE FROM ${this.table(table)} WHERE id=?`).run(key);
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  artifact(questId, kind, content) {
    if (!/^[\w-]+$/.test(questId) || !/^[\w-]+$/.test(kind))
      throw new Error("Invalid artifact path");
    const revision =
      this.all("artifacts").filter(
        (a) => a.questId === questId && a.kind === kind,
      ).length + 1;
    const dir = path.join(this.dir, "quests", questId);
    mkdirSync(path.join(dir, "versions"), { recursive: true });
    const file = path.join(dir, "versions", `${kind}-${revision}-${id()}.md`);
    writeFileSync(file, content, { flag: "wx", mode: 0o600 });
    const record = this.put("artifacts", {
      id: id(),
      questId,
      kind,
      revision,
      hash: hash(content),
      file,
      createdAt: new Date().toISOString(),
    });
    this.materialize(record);
    return record;
  }
  materialize(artifact) {
    const content = this.content(artifact);
    const target = path.join(
      this.dir,
      "quests",
      artifact.questId,
      `${artifact.kind}.md`,
    );
    const temp = `${target}.tmp`;
    writeFileSync(temp, content, { mode: 0o600 });
    renameSync(temp, target);
  }
  content(artifact) {
    const content = readFileSync(artifact.file, "utf8");
    if (hash(content) !== artifact.hash)
      throw new Error(
        `Artifact integrity mismatch: ${artifact.kind} revision ${artifact.revision}`,
      );
    return content;
  }
  latest(questId, kind) {
    return this.all("artifacts")
      .filter((a) => a.questId === questId && a.kind === kind)
      .at(-1);
  }
  claimInstance() {
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS instance (slot INTEGER PRIMARY KEY CHECK(slot=1), pid INTEGER NOT NULL, token TEXT NOT NULL)",
    );
    this.transaction(() => {
      const owner = this.db
        .prepare("SELECT pid FROM instance WHERE slot=1")
        .get();
      if (owner) {
        let alive = false;
        try {
          process.kill(owner.pid, 0);
          alive = true;
        } catch (error) {
          alive = error.code === "EPERM";
        }
        if (alive)
          throw new Error(
            `This data directory is already owned by process ${owner.pid}. Close that DevQuest instance first.`,
          );
      }
      this.instanceToken = id();
      this.db
        .prepare(
          "INSERT OR REPLACE INTO instance(slot,pid,token) VALUES(1,?,?)",
        )
        .run(process.pid, this.instanceToken);
    });
  }
  close() {
    if (this.instanceToken)
      this.db
        .prepare("DELETE FROM instance WHERE slot=1 AND token=?")
        .run(this.instanceToken);
    this.db.close();
  }
}
