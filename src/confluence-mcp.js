import { readFile, writeFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { preflightJiraMcp, sanitizeMcpError } from "./jira-mcp.js";
import { confluenceReads } from "./jira-mcp-policy.js";
import { jiraObjects } from "./jira-project.js";

// Uses Claude's existing MCP OAuth store with the deterministic loopback API, never a paid model.
export class ConfluenceMcpAdapter {
  constructor({
    host,
    runtime,
    mcpConfigPath = path.join(homedir(), ".claude.json"),
    mcpServer = "atlassian",
    maxPages = 10,
    maxBodyBytes = 1_000_000,
    timeoutMs = 120_000,
  } = {}) {
    const url = host ? new URL(host) : null;
    if (
      !url ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error("Configure an HTTPS Confluence site origin");
    this.origin = url.origin;
    this.runtime = runtime;
    this.configPath = mcpConfigPath;
    this.server = mcpServer;
    this.maxPages = Math.max(1, Math.min(10, Math.floor(maxPages)));
    this.maxBodyBytes = maxBodyBytes;
    this.timeoutMs = timeoutMs;
    this.controllers = new Set();
    this.closed = false;
    if (
      !Number.isFinite(this.maxPages) ||
      !Number.isInteger(maxBodyBytes) ||
      maxBodyBytes < 1 || maxBodyBytes > 1_000_000 ||
      !Number.isFinite(timeoutMs) ||
      timeoutMs < 1
    )
      throw new Error("Invalid Confluence import limits");
  }

  close() {
    this.closed = true;
    this.checkpoint = undefined;
    for (const controller of this.controllers) controller.abort();
  }

  async #session(operation, { mainId, onProgress } = {}) {
    if (this.closed) throw new Error("Confluence import is stopping");
    if (this.runtime?.name !== "Claude Code")
      throw new Error("Configure Claude Code for the existing Atlassian MCP connection");
    if (!/^[\w-]+$/.test(this.server)) throw new Error("Invalid Atlassian MCP server name");
    let server;
    try {
      server = JSON.parse(await readFile(this.configPath, "utf8")).mcpServers?.[this.server];
    } catch {}
    if (!server || !["http", "sse"].includes(server.type) || !/^https:\/\//.test(server.url || ""))
      throw new Error("Configure the existing HTTPS Atlassian MCP connection in Claude Code first");
    const directory = await mkdtemp(path.join(tmpdir(), "devquest-confluence-"));
    const controller = new AbortController();
    this.controllers.add(controller);
    if (this.closed) controller.abort();
    const deadline = Date.now() + this.timeoutMs;
    let expired = false,
      reconnects = 0,
      stage = "connecting to Atlassian MCP";
    const timer = setTimeout(() => {
      expired = true;
      controller.abort();
    }, this.timeoutMs);
    timer.unref?.();
    try {
      const mcpConfig = path.join(directory, "mcp.json");
      const artifactDirectory = path.join(directory, "artifacts");
      await mkdir(artifactDirectory, { mode: 0o700 });
      await writeFile(mcpConfig, JSON.stringify({ mcpServers: { [this.server]: server } }), {
        mode: 0o600,
      });
      const run = async (cloudId, readWorkflow) => {
        for (;;) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) {
            expired = true;
            throw new Error("Import deadline reached");
          }
          stage = "connecting to Atlassian MCP";
          onProgress?.(reconnects ? "Reconnecting to Atlassian MCP…" : "Connecting to Atlassian MCP…");
          try {
            return await preflightJiraMcp({
              start: this.runtime.start.bind(this.runtime),
              prepared: {
                mcpConfig,
                artifactDirectory,
                mcpGuard: {
                  server: this.server,
                  stage: "confluence",
                  siteUrl: this.origin,
                  ...(cloudId ? { cloudId } : {}),
                  ...(mainId ? { mainId } : {}),
                },
                mcpTools: confluenceReads.map((method) => `mcp__${this.server}__${method}`),
              },
              readWorkflow,
              timeoutMs: reconnects ? remaining : Math.max(1, Math.floor(remaining / 2)),
              onReadProgress: (method) => {
                stage = method;
              },
              signal: controller.signal,
              configDirectory:
                this.runtime.env?.CLAUDE_CONFIG_DIR ||
                process.env.CLAUDE_CONFIG_DIR ||
                path.join(homedir(), ".claude"),
            });
          } catch (error) {
            if (
              error.code !== "MCP_READ_TIMEOUT" ||
              reconnects ||
              controller.signal.aborted ||
              Date.now() >= deadline
            )
              throw error;
            reconnects++;
          }
        }
      };
      return await operation(run);
    } catch (error) {
      if (expired)
        throw new Error(
          `Confluence import timed out after ${Math.ceil(this.timeoutMs / 1000)} seconds during ${stage}. No project was created and no paid generation started.`,
          { cause: error },
        );
      throw error;
    } finally {
      clearTimeout(timer);
      this.controllers.delete(controller);
      await rm(directory, { recursive: true, force: true });
    }
  }

  async #discover(run) {
    return run(undefined, ({ evidence, inventory }) => {
      if (!evidence.length) return { request: ["getAccessibleAtlassianResources", {}] };
      if (evidence[0].isError)
        throw new Error(
          `Atlassian MCP resource discovery failed: ${sanitizeMcpError(evidence[0].content)}; check the existing connection authentication`,
        );
      const resources = jiraObjects(evidence[0].content).filter((resource) => {
        try {
          return resource.id && new URL(resource.url).origin === this.origin;
        } catch {
          return false;
        }
      });
      const ids = [...new Set(resources.map((resource) => resource.id))];
      if (ids.length !== 1)
        throw new Error(
          "The configured Confluence site is missing or ambiguous in the authenticated Atlassian MCP resources",
        );
      const tools = inventory.filter(
        (tool) =>
          confluenceReads.includes(tool.name.split("__").at(-1)) &&
          tool.name.startsWith(`mcp__${this.server}__`),
      );
      if (!tools.some((tool) => tool.name === `mcp__${this.server}__getConfluencePage`))
        throw new Error("The selected Atlassian MCP connection does not expose getConfluencePage");
      const properties = tools.find(
        (tool) => tool.name === `mcp__${this.server}__getConfluencePage`,
      ).input_schema?.properties;
      const pageFormat = properties?.contentFormat?.enum?.includes("markdown")
        ? { contentFormat: "markdown" }
        : properties?.contentFormat?.enum?.includes("html")
          ? { contentFormat: "html" }
          : properties?.bodyFormat?.enum?.includes("storage")
            ? { bodyFormat: "storage" }
            : null;
      if (!pageFormat)
        throw new Error(
          "The Atlassian MCP page tool has no verified Markdown/HTML/storage read format",
        );
      return { result: { siteUrl: this.origin, cloudId: ids[0], pageFormat, tools } };
    });
  }

  // A connection check reads tenant metadata only; it never imports or changes a Quest.
  async inspect() {
    return this.#session((run) => this.#discover(run));
  }

  async fetch(rawUrl, { importId, onProgress } = {}) {
    const mainUrl = new URL(rawUrl);
    if (
      mainUrl.protocol !== "https:" ||
      mainUrl.origin !== this.origin ||
      mainUrl.username ||
      mainUrl.password
    )
      throw new Error("URL must use the configured Confluence host over HTTPS");
    const mainId = pageIdFromUrl(mainUrl);
    if (!/^\d+$/.test(mainId || ""))
      throw new Error("Confluence page URL does not contain a page id");
    const result = await this.#session(async (run) => {
      const discovery = await this.#discover(run);
      const key = JSON.stringify([importId, mainUrl.href, discovery.cloudId, discovery.pageFormat]);
      // shortcut: one in-memory checkpoint survives retries in the open form for 15 minutes.
      const checkpoint = this.checkpoint;
      const resume = importId && checkpoint?.key === key && checkpoint.expiresAt > Date.now();
      const read = resume ? checkpoint.read : confluenceImportWorkflow({
        ...this,
        mainUrl,
        mainId,
        cloudId: discovery.cloudId,
        pageFormat: discovery.pageFormat,
        ancestrySearch: discovery.tools.some((tool) =>
          tool.name.endsWith("__searchConfluenceUsingCql") &&
          tool.input_schema?.properties?.cql && tool.input_schema?.properties?.limit),
      });
      if (importId) this.checkpoint = { key, read, expiresAt: Date.now() + 900_000 };
      if (resume) onProgress?.("Resuming from pages already imported…");
      return run(discovery.cloudId, (state) => read(state, onProgress));
    }, { mainId, onProgress });
    if (importId) this.checkpoint = undefined;
    return result;
  }
}

export function confluenceImportWorkflow({
  origin,
  mainUrl,
  mainId,
  cloudId,
  maxPages,
  maxBodyBytes,
  pageFormat = { contentFormat: "html" },
  ancestrySearch = false,
}) {
  const candidates = [];
  const titles = new Set();
  const externalLinks = new Set();
  let index = 0, ancestryChecked = false;
  const pages = [],
    warnings = [],
    seen = new Set([String(mainId)]);
  const pageRequest = (pageId) => [
    "getConfluencePage",
    { cloudId, pageId: String(pageId), ...pageFormat },
  ];
  const readPage = (entry, id) => {
    if (entry.isError) throw new Error(sanitizeMcpError(entry.content));
    if (Buffer.byteLength(JSON.stringify(entry.content)) > maxBodyBytes)
      throw new Error("Confluence response exceeds configured body limit");
    const page = jiraObjects(entry.content).find(
      (page) => String(page.id) === String(id) && typeof page.title === "string",
    );
    const html =
      page?.body?.markdown?.value ??
      page?.body?.storage?.value ??
      page?.body?.html?.value ??
      page?.body?.value ??
      (typeof page?.body === "string" ? page.body : undefined);
    if (typeof html !== "string")
      throw new Error(
        "Confluence MCP returned incomplete page content; HTML/storage body and matching page ID are required",
      );
    return { ...page, body: { storage: { value: html } } };
  };
  const enqueue = (id, url) => {
    if (!/^\d+$/.test(id || "") || seen.has(id)) return;
    seen.add(id);
    candidates.push({ id, url });
  };
  const addLinks = (page, url) => {
    const body = page.body.storage.value;
    for (const link of linkedUrls(body, new URL(url))) {
      if (link.origin === origin && !link.username && !link.password) {
        const id = pageIdFromUrl(link);
        const friendlyUrl = link.pathname.includes("/pages/") ? origin + link.pathname : undefined;
        enqueue(id, friendlyUrl);
      }
      else if (/^https?:$/.test(link.protocol)) externalLinks.add(link.hostname);
    }
    for (const title of storagePageTitles(body)) {
      if (titles.has(title)) continue;
      titles.add(title);
      candidates.push({ title });
    }
  };
  return ({ evidence }, onProgress) => {
    const pageEntry = (id) =>
      evidence.find(
        (e) => e.method === "getConfluencePage" && String(e.input.pageId) === String(id),
      );
    if (!pages.length) {
      const entry = pageEntry(mainId);
      if (!entry) {
        onProgress?.("Reading the main Confluence page…");
        return { request: pageRequest(mainId) };
      }
      const main = readPage(entry, mainId);
      pages.push({ page: main, url: mainUrl.href });
      addLinks(main, mainUrl.href);
    }
    if (ancestrySearch && !ancestryChecked) {
      const cql = `type = page AND ancestor = ${mainId}`;
      const entry = evidence.find((e) => e.method === "searchConfluenceUsingCql" && e.input.cql === cql);
      if (!entry) {
        onProgress?.("Finding child pages and descendants…");
        return { request: ["searchConfluenceUsingCql", { cloudId, cql, limit: 10 }] };
      }
      ancestryChecked = true;
      if (entry.isError) warnings.push("Confluence descendant search failed. Unlinked child pages may be missing.");
      else {
        const objects = jiraObjects(entry.content);
        const response = objects.find((item) => Array.isArray(item.results));
        if (!response) warnings.push("Confluence descendant search did not return a verified result list.");
        else {
          for (const result of response.results) {
            const child = result.content || result;
            if (!child.type || child.type === "page") enqueue(String(child.id || ""));
          }
          if (response._links?.next || response.totalSize > response.results.length || response.results.length >= 10)
            warnings.push("Confluence descendant discovery reached its result limit. Additional child pages may be missing.");
        }
      }
    }
    while (index < candidates.length && index < maxPages - 1) {
      const candidate = candidates[index];
      try {
        if (!candidate.id) {
          const cql = `type = page AND title = "${candidate.title.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
          const entry = evidence.find(
            (e) => e.method === "searchConfluenceUsingCql" && e.input.cql === cql,
          );
          if (!entry) {
            onProgress?.(`Resolving a linked page · ${pages.length} imported…`);
            return { request: ["searchConfluenceUsingCql", { cloudId, cql, limit: 2 }] };
          }
          if (entry.isError) throw new Error(sanitizeMcpError(entry.content));
          const objects = jiraObjects(entry.content);
          const matches = [
            ...new Map(
              objects
                .filter(
                  (o) =>
                    /^\d+$/.test(String(o.id || "")) &&
                    o.title === candidate.title &&
                    (!o.type || o.type === "page"),
                )
                .map((o) => [String(o.id), o]),
            ).values(),
          ];
          if (matches.length !== 1 || objects.some((o) => o._links?.next || o.totalSize > 1))
            throw new Error("Linked page title did not resolve to one verified page");
          candidate.id = String(matches[0].id);
          if (seen.has(candidate.id)) {
            index++;
            continue;
          }
          seen.add(candidate.id);
        }
        const entry = pageEntry(candidate.id);
        if (!entry) {
          onProgress?.(`Reading linked or child page ${candidate.id} · ${pages.length} imported…`);
          return { request: pageRequest(candidate.id) };
        }
        const page = readPage(entry, candidate.id);
        const url = candidate.url || new URL(`/wiki/pages/viewpage.action?pageId=${page.id}`, origin).href;
        pages.push({ page, url });
        addLinks(page, url);
      } catch (error) {
        warnings.push(
          `Could not load linked Confluence page ${candidate.id || candidate.title}: ${error.message}`,
        );
      }
      index++;
    }
    const omissions = [];
    if (!ancestrySearch) omissions.push("This MCP tool schema does not support verified descendant discovery. Unlinked child pages may be missing.");
    if (index < candidates.length)
      omissions.push(`Omitted ${candidates.length - index} Confluence page(s) at the ${maxPages}-page limit: ${candidates.slice(index, index + 10).map(({ id, title }) => id || title).join(", ")}`);
    if (externalLinks.size)
      omissions.push(`External linked documents were not imported: ${[...externalLinks].slice(0, 10).join(", ")}`);
    onProgress?.(`Saving the local PRD snapshot · ${pages.length} pages imported…`);
    return {
      result: {
        content: pages
          .map(({ page }) => `# ${page.title}\n\n${page.body.storage.value}`)
          .join("\n\n"),
        sources: pages.map(({ page, url }) => ({
          id: String(page.id),
          title: page.title,
          url,
          version: page.version?.number,
        })),
        warnings: [...warnings, ...omissions],
      },
    };
  };
}

export function pageIdFromUrl(url) {
  return /\/pages\/(\d+)(?:\/|$)/.exec(url.pathname)?.[1] ?? url.searchParams.get("pageId");
}

export function linkedUrls(html, base) {
  const urls = [];
  const matches = [
    ...html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi),
    ...html.matchAll(/\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g),
    ...html.matchAll(/<(https?:\/\/[^>\s]+)>/g),
    ...html.matchAll(/^\s{0,3}\[[^\]]+\]:\s*<?([^>\s]+)/gm),
    ...html.matchAll(/(?:^|[\s(])(https?:\/\/[^\s<>"')\]]+)/g),
  ];
  for (const match of matches) {
    try {
      urls.push(new URL(match[1].replaceAll("&amp;", "&"), base));
    } catch {
      // Invalid document links are ignored; the source body is still usable.
    }
  }
  return urls;
}

export function storagePageTitles(html) {
  const decode = (value) =>
    value
      .replaceAll("&amp;", "&")
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">");
  return [...html.matchAll(/<ri:page\b[^>]*\bri:content-title\s*=\s*["']([^"']+)["']/gi)].map(
    (match) => decode(match[1]),
  );
}
