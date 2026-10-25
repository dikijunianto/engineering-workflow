import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Vector3, PerspectiveCamera } from "three";
import { cameraFrame, STATIONS, HANDOFF_LABELS } from "../ui/engineering-scene.js";

test("bounds framing keeps all corners visible at supported orbit and zoom limits", () => {
  for (const aspect of [0.6, 1, 1.4, 2.5])
    for (const yaw of [-0.65, 0.38, 0.8])
      for (const pitch of [0.55, 0.78, 1.15])
        for (const zoom of [0.75, 1, 1.15]) {
          for (const b of [
            new Box3(new Vector3(-12, -0.4, -8), new Vector3(12, 4, 9)),
            new Box3(new Vector3(-11, -0.3, 1.5), new Vector3(3.3, 3.5, 8.4)),
          ]) {
            const fit = cameraFrame(b, aspect, yaw, pitch, zoom),
              camera = new PerspectiveCamera(38, aspect, 0.1, 150);
            camera.position.copy(fit.position);
            camera.lookAt(fit.center);
            camera.updateMatrixWorld();
            for (const x of [b.min.x, b.max.x])
              for (const y of [b.min.y, b.max.y])
                for (const z of [b.min.z, b.max.z]) {
                  const point = new Vector3(x, y, z).project(camera);
                  assert.ok(
                    Math.abs(point.x) < 1 && Math.abs(point.y) < 1,
                    `clipped at ${aspect}/${yaw}/${pitch}/${zoom}`,
                  );
                }
          }
        }
});
test("six selected stages have stable, distinct identities and bounded handoff explanations", () => {
  assert.equal(STATIONS.length, 6);
  assert.equal(new Set(STATIONS.map((s) => s.id)).size, 6);
  for (const station of STATIONS) assert.ok(HANDOFF_LABELS[station.id]?.length >= 3);
  assert.deepEqual(HANDOFF_LABELS.worktrees, [
    "Approved plan",
    "T-01 / DEV-A executes",
    "T-01 result validated",
    "Serialize T-01 result",
    "Independent REV-A review",
  ]);
  assert.match(HANDOFF_LABELS.review.at(-1), /Await human/);
});
