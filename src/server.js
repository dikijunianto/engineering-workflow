import http from "node:http";
import path from "node:path";
import os from "node:os";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Store } from "./store.js";
import { Engine, ACTIONS } from "./engine.js";
import { createAdapters } from "./adapters.js";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const assets = new Map([
  ["/", ["index.html", "text/html"]],
  ["/app.js", ["app.js", "text/javascript"]],
  [
    "/vendor/marked.js",
    ["../node_modules/marked/lib/marked.esm.js", "text/javascript"],
  ],
  ["/style.css", ["style.css", "text/css"]],
  [
    "/devquest/backgrounds/midnight-reach.png",
    ["devquest/backgrounds/midnight-reach.png", "image/png"],
  ],
]);
const json = (response, status, value) => {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
};

async function body(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 12 * 1024 * 1024) throw new Error("Request exceeds 12 MB");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request must be valid JSON");
  }
}
export async function importFile(file) {
  if (!file || typeof file.name !== "string" || typeof file.base64 !== "string")
    throw new Error("Invalid uploaded file");
  const buffer = Buffer.from(file.base64, "base64");
  if (buffer.length > 8 * 1024 * 1024) throw new Error("File exceeds 8 MB");
  const extension = path.extname(file.name).toLowerCase();
  if ([".md", ".txt"].includes(extension)) return buffer.toString("utf8");
  if (extension === ".docx") {
    const mammoth = await import("mammoth");
    return (await mammoth.default.extractRawText({ buffer })).value;
  }
  if (extension === ".pdf") {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useSystemFonts: false,
      standardFontDataUrl: fileURLToPath(
        new URL(
          "../../standard_fonts/",
          import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs"),
        ),
      ).replaceAll(path.sep, "/"),
    });
    const document = await loadingTask.promise;
    try {
      if (document.numPages > 200) throw new Error("PDF exceeds 200 pages");
      let content = "";
      for (let page = 1; page <= document.numPages; page++) {
        const data = await (await document.getPage(page)).getTextContent();
        content += data.items.map((item) => item.str || "").join(" ") + "\n";
        if (content.length > 100000)
          throw new Error("Extracted text exceeds 100,000 characters");
      }
      if (!content.trim())
        throw new Error(
          "PDF has no readable text. Export a text PDF or Markdown; OCR is not included.",
        );
      return content;
    } finally {
      await loadingTask.destroy();
    }
  }
  throw new Error("Supported formats: .md, .txt, .pdf, .docx");
}

export async function createServer({
  dataDir = path.join(os.homedir(), ".devquest"),
  adapters,
  config = {},
  port = 4310,
} = {}) {
  const store = new Store(dataDir),
    clients = new Set();
  try {
    store.claimInstance();
  } catch (error) {
    store.close();
    throw error;
  }
  const token = randomBytes(32).toString("hex");
  const emit = (event) => {
    for (const client of clients)
      client.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  let engine;
  try {
    engine = new Engine({
      store,
      adapters: adapters || (await createAdapters(config)),
      emit,
      concurrency: config.concurrency,
    });
    await engine.initialize();
  } catch (error) {
    store.close();
    throw error;
  }
  const server = http.createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const expected = `127.0.0.1:${server.address().port}`;
    const host = request.headers.host;
    if (host !== expected && host !== `localhost:${server.address().port}`)
      return json(response, 403, { error: "Untrusted Host" });
    if (request.headers.origin && request.headers.origin !== `http://${host}`)
      return json(response, 403, { error: "Cross-origin requests are denied" });
    if (request.headers["sec-fetch-site"] === "cross-site")
      return json(response, 403, { error: "Cross-site requests are denied" });
    const url = new URL(request.url, `http://${expected}`);
    try {
      if (request.method === "GET" && assets.has(url.pathname)) {
        const [file, mime] = assets.get(url.pathname);
        response.writeHead(200, { "Content-Type": `${mime}; charset=utf-8` });
        return response.end(readFileSync(path.join(publicDir, file)));
      }
      if (request.method === "GET" && url.pathname === "/api/session")
        return json(response, 200, { token });
      if (request.method === "GET" && url.pathname === "/api/state")
        return json(response, 200, engine.snapshot());
      if (
        request.method === "GET" &&
        url.pathname.startsWith("/api/artifacts/")
      ) {
        const artifact = store.get(
          "artifacts",
          url.pathname.slice("/api/artifacts/".length),
        );
        if (!artifact)
          return json(response, 404, { error: "Artifact not found" });
        const content = store.content(artifact);
        response.writeHead(200, {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="${artifact.kind}-r${artifact.revision}.md"`,
        });
        return response.end(content);
      }
      if (request.method === "GET" && url.pathname === "/api/events") {
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          Connection: "keep-alive",
        });
        response.write(": connected\n\n");
        clients.add(response);
        const heartbeat = setInterval(
          () => response.write(": heartbeat\n\n"),
          20000,
        );
        request.on("close", () => {
          clearInterval(heartbeat);
          clients.delete(response);
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/action") {
        const candidate = Buffer.from(
          String(request.headers["x-devquest-token"] || ""),
        );
        if (
          candidate.length !== token.length ||
          !timingSafeEqual(candidate, Buffer.from(token))
        )
          return json(response, 403, {
            error: "Invalid session token; reload the page",
          });
        if (
          !String(request.headers["content-type"]).startsWith(
            "application/json",
          )
        )
          return json(response, 415, { error: "Use application/json" });
        const input = await body(request);
        if (!input || Array.isArray(input) || !ACTIONS.has(input.type))
          throw new Error("Unknown action");
        if (input.type === "CREATE_QUEST" && input.file)
          input.content = await importFile(input.file);
        const { type, ...parameters } = input;
        return json(response, 200, {
          result: await engine.action(type, parameters),
        });
      }
      json(response, 404, { error: "Not found" });
    } catch (error) {
      json(response, 400, { error: error.message || "Action failed" });
    }
  });
  server.requestTimeout = 30000;
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
  } catch (error) {
    store.close();
    throw error;
  }
  return {
    server,
    engine,
    store,
    url: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      for (const client of clients) client.end();
      await engine.close();
      await new Promise((resolve) => server.close(resolve));
      store.close();
    },
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const configPath =
    process.env.DEVQUEST_CONFIG ||
    path.join(os.homedir(), ".devquest", "config.json");
  const config = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, "utf8"))
    : {};
  const app = await createServer({
    config,
    dataDir: process.env.DEVQUEST_HOME,
    port: Number(process.env.PORT || 4310),
  });
  console.log(`DevQuest is ready at ${app.url}`);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}
