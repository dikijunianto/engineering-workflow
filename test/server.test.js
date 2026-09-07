import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { createServer, importFile } from "../src/server.js";
import { Store } from "../src/store.js";

test("a data directory is owned by one live application instance", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "devquest-instance-"));
  const first = new Store(dir),
    second = new Store(dir);
  first.claimInstance();
  assert.throws(() => second.claimInstance(), /already owned/);
  first.close();
  second.claimInstance();
  second.close();
});

test("loopback API rejects foreign origins, spoofed hosts, missing token and arbitrary shell", async (t) => {
  const app = await createServer({
    dataDir: mkdtempSync(path.join(os.tmpdir(), "devquest-http-")),
    port: 0,
    adapters: { config: {}, runtimes: {}, git: {} },
  });
  t.after(() => app.close());
  const page = await fetch(app.url);
  assert.equal(page.status, 200);
  assert.ok(
    page.headers
      .get("content-security-policy")
      .includes("frame-ancestors 'none'"),
  );
  assert.ok((await page.text()).includes("DevQuest"));
  const art = await fetch(`${app.url}/devquest/backgrounds/midnight-reach.png`);
  assert.equal(art.status, 200);
  assert.match(art.headers.get("content-type"), /^image\/png/);
  assert.deepEqual(
    [...new Uint8Array(await art.arrayBuffer()).slice(0, 4)],
    [137, 80, 78, 71],
  );
  const foreign = await fetch(`${app.url}/api/state`, {
    headers: { Origin: "https://malicious.example" },
  });
  assert.equal(foreign.status, 403);
  const port = app.server.address().port;
  const rebinding = await new Promise((resolve, reject) => {
    http
      .get(
        {
          hostname: "127.0.0.1",
          port,
          path: "/api/session",
          headers: { Host: `malicious.example:${port}` },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      )
      .on("error", reject);
  });
  assert.equal(rebinding, 403);
  assert.equal(
    (
      await fetch(`${app.url}/api/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"type":"RECONCILE"}',
      })
    ).status,
    403,
  );
  const { token } = await (await fetch(`${app.url}/api/session`)).json();
  const send = (value) =>
    fetch(`${app.url}/api/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-DevQuest-Token": token,
      },
      body: JSON.stringify(value),
    });
  assert.equal(
    (await send({ type: "SHELL", command: "echo unsafe" })).status,
    400,
  );
  assert.equal((await send({ type: "RECONCILE" })).status, 200);
  assert.equal((await fetch(`${app.url}/shell`)).status, 404);
  assert.equal((await fetch(`${app.url}/../src/store.js`)).status, 404);
});
test("local file ingestion accepts text and rejects unsupported formats and empty input", async () => {
  assert.equal(
    await importFile({
      name: "prd.md",
      base64: Buffer.from("# Requirement").toString("base64"),
    }),
    "# Requirement",
  );
  await assert.rejects(
    importFile({ name: "script.exe", base64: "" }),
    /Supported formats/,
  );
  await assert.rejects(importFile(null), /Invalid uploaded/);
});

test("Word intake extracts text from a valid minimal DOCX archive", async () => {
  const base64 =
    "UEsDBAoAAAAAAGZ4Jl0AAAAAAAAAAAAAAAAFAAAAd29yZC9QSwMECgAAAAgAZngmXVZ5/IeBAAAAqwAAABEAAAB3b3JkL2RvY3VtZW50LnhtbEXOOw4CIRAG4KuQPYCzsbAgSOUFrKwRxl2SHcABRG8vrIXNN5n8mYdq0kVbCUMRb9pClu08raUkCZDtimTyISYMPXtEJlN6ywu0yC5xtJizDwttcJznE5DxYdKqyXt0n1HTgAdFX/B1rZiLuPVZwfisnnHcVTDiIe+m3d8K+L+nv1BLAQIUAAoAAAAAAGZ4Jl0AAAAAAAAAAAAAAAAFAAAAAAAAAAAAEAAAAAAAAAB3b3JkL1BLAQIUAAoAAAAIAGZ4Jl1WefyHgQAAAKsAAAARAAAAAAAAAAAAAAAAACMAAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAgACAHIAAADTAAAAAAA=";
  assert.match(
    await importFile({ name: "requirement.docx", base64 }),
    /DevQuest Word requirement/,
  );
});

test("PDF intake extracts text from a real single-page PDF", async () => {
  const stream = "BT /F1 12 Tf 50 750 Td (DevQuest PDF requirement) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  assert.match(
    await importFile({
      name: "requirement.pdf",
      base64: Buffer.from(pdf).toString("base64"),
    }),
    /DevQuest PDF requirement/,
  );
});
