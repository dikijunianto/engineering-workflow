import http from "node:http";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { realpath, open } from "node:fs/promises";
import { preflightAccess } from "./access.js";

// Codex receives only this read tool; no shell or writable additional directories.
export async function createRepositoryReader(scope, onCall = () => {}) {
  if (!scope.readOnly)
    throw new Error("Repository reader requires read-only scope");
  const preflight = await preflightAccess(scope);
  const calls = [];
  const tool = {
    name: "ReadRepositoryFile",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "Read a UTF-8 file inside one selected repository using its repoId and relative path. No directory discovery or writes.",
    inputSchema: {
      type: "object",
      properties: { repoId: { type: "string" }, path: { type: "string" } },
      required: ["repoId", "path"],
      additionalProperties: false,
    },
  };
  async function read(input) {
    const repo = preflight.repositories.find(
      (repo) => repo.id === input.repoId,
    );
    if (
      !repo ||
      typeof input.path !== "string" ||
      !input.path ||
      input.path.length > 4096 ||
      path.isAbsolute(input.path) ||
      input.path.split(/[\\/]/).includes("..")
    )
      throw new Error(
        "Access denied: use a selected repoId and a repository-relative file path",
      );
    const target = await realpath(path.join(repo.canonicalPath, input.path));
    const relative = path.relative(repo.canonicalPath, target);
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      throw new Error(
        "Access denied: resolved path is outside the selected repository root",
      );
    const file = await open(target, "r");
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > 64000)
        throw new Error("Read a regular file of at most 64,000 bytes");
      return await file.readFile("utf8");
    } finally {
      await file.close();
    }
  }
  const secretPath = `/${randomBytes(24).toString("hex")}`;
  const server = http.createServer(async (request, response) => {
    const send = (status, value) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(value == null ? undefined : JSON.stringify(value));
    };
    if (
      request.url !== secretPath ||
      request.headers.host !== `127.0.0.1:${server.address().port}` ||
      request.headers.origin
    )
      return send(403, null);
    if (request.method !== "POST") return send(405, null);
    let message;
    try {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 8192) return send(413, null);
      }
      message = JSON.parse(body);
      if (message.id == null) return send(202, null);
      let result;
      if (message.method === "initialize")
        result = {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "devquest-repository-reader", version: "1" },
        };
      else if (message.method === "tools/list") result = { tools: [tool] };
      else if (message.method === "tools/call") {
        const args = message.params?.arguments || {};
        const entry = {
          operation: message.params?.name,
          repoId: args.repoId,
          path: args.path,
        };
        try {
          if (message.params?.name !== tool.name)
            throw new Error(
              "Access denied: only repository file reads are supported",
            );
          const text = await read(args);
          result = { content: [{ type: "text", text }] };
          entry.status = "PASSED";
        } catch (error) {
          result = {
            isError: true,
            content: [{ type: "text", text: error.message }],
          };
          entry.status = "DENIED";
          entry.error = error.message;
        }
        calls.push(entry);
        onCall(entry);
      } else if (message.method === "ping") result = {};
      else
        return send(200, {
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: "Method not found" },
        });
      send(200, { jsonrpc: "2.0", id: message.id, result });
    } catch {
      send(400, {
        jsonrpc: "2.0",
        id: message?.id || null,
        error: { code: -32600, message: "Invalid repository reader request" },
      });
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}${secretPath}`,
    preflight,
    calls,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
}
