import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

test("vendored icon sprite has pinned provenance, complete license notices and no executable assets", () => {
  const root = new URL("../", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("docs/design/asset-provenance.json", root)));
  const sprite = readFileSync(new URL("public/icons/lucide.svg", root), "utf8");
  assert.match(manifest.commit, /^[a-f0-9]{40}$/);
  assert.equal(manifest.assets.length, 25);
  for (const asset of manifest.assets) {
    assert.ok(asset.sourceUrl.includes(manifest.commit));
    assert.match(asset.sourceSha256, /^[a-f0-9]{64}$/);
    assert.ok(sprite.includes(`<symbol id="${asset.name}"`));
  }
  assert.doesNotMatch(sprite, /<script|<foreignObject|on\w+=|href=/i);
  const license = readFileSync(new URL(manifest.licenseFile, root), "utf8");
  assert.match(license, /ISC License/);
  assert.match(license, /MIT License/);
  assert.equal(existsSync(new URL("public/devquest/backgrounds/midnight-reach.png", root)), false);
});
