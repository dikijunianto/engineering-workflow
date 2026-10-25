import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export const STATIONS = [
  { id: "intake", name: "Intake & repositories", x: -8, z: -4, color: 0x71afd5 },
  { id: "analysis", name: "Repository analysis", x: 0, z: -4, color: 0x71afd5 },
  { id: "design", name: "TRD & planning", x: 8, z: -4, color: 0xe4b56a },
  { id: "jira", name: "Jira backlog", x: 8, z: 5, color: 0xe4b56a },
  { id: "worktrees", name: "Isolated worktrees", x: 0, z: 5, color: 0x65cba7 },
  { id: "review", name: "Independent review", x: -8, z: 5, color: 0xc998c3 },
];
export function cameraFrame(bounds, aspect, yaw = 0.38, pitch = 0.78, zoom = 1) {
  const center = bounds.getCenter(new T.Vector3());
  const direction = new T.Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(yaw) * Math.cos(pitch),
  );
  const right = new T.Vector3().crossVectors(new T.Vector3(0, 1, 0), direction).normalize(),
    up = new T.Vector3().crossVectors(direction, right);
  const tan = Math.tan((38 * Math.PI) / 360);
  let distance = 0;
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z]) {
        const v = new T.Vector3(x, y, z).sub(center);
        distance = Math.max(
          distance,
          v.dot(direction) +
            Math.max(
              Math.abs(v.dot(right)) / (tan * Math.max(aspect, 0.2)),
              Math.abs(v.dot(up)) / tan,
            ) *
              1.32,
        );
      }
  return { center, position: center.clone().addScaledVector(direction, distance / zoom) };
}
export const HANDOFF_LABELS = {
  intake: ["Specification received", "Bind selected repositories", "Scope ready"],
  analysis: ["Inspect selected services", "Trace dependencies", "Record constraints"],
  design: ["Open blueprint", "Break down tasks", "Await human approval"],
  jira: ["Approved plan", "Prepare task cards", "Review backlog before publishing"],
  worktrees: [
    "Approved plan",
    "T-01 / DEV-A executes",
    "T-01 result validated",
    "Serialize T-01 result",
    "Independent REV-A review",
  ],
  review: ["Integrated change", "Independent inspection", "Await human PR approval"],
};
export function createEngineeringScene(canvas, labels, onSelect, onFail, onPhase = () => {}) {
  const started = performance.now();
  let loadedMs = 0;
  const renderer = new T.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setClearColor(0x111820);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera(38, 1, 0.1, 150);
  scene.add(new T.HemisphereLight(0xb9d8ef, 0x303138, 2.2));
  const sun = new T.DirectionalLight(0xffedda, 4);
  sun.position.set(-8, 22, 12);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 20, bottom: -20, far: 65 });
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.001;
  scene.add(sun);
  const fill = new T.DirectionalLight(0x8bbfff, 2);
  fill.position.set(10, 8, -12);
  scene.add(fill);
  const materials = new Map(),
    geometries = new Map(),
    textures = [],
    gates = [],
    screens = [];
  function mat(color) {
    if (!materials.has(color))
      materials.set(color, new T.MeshStandardMaterial({ color, roughness: 0.56, metalness: 0.25 }));
    return materials.get(color);
  }
  function box(g, x, y, z, w, h, d, color = 0x45515f) {
    const key = [w, h, d].join();
    if (!geometries.has(key))
      geometries.set(key, new RoundedBoxGeometry(w, h, d, 2, Math.min(0.065, w / 6, h / 6, d / 6)));
    const m = new T.Mesh(geometries.get(key), mat(color));
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  }
  function sign(g, text, x, y, z, w = 2) {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 96;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#17212b";
    ctx.fillRect(0, 0, 512, 96);
    ctx.font = "600 34px monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#e2eaf0";
    ctx.fillText(text, 256, 60);
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    textures.push(tex);
    const geo = new T.PlaneGeometry(w, (w * 96) / 512),
      material = new T.MeshBasicMaterial({ map: tex });
    geometries.set(Symbol(), geo);
    materials.set(Symbol(), material);
    const m = new T.Mesh(geo, material);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  }
  function paper(g, x, y, z, color = 0xe0d5b9) {
    const m = box(g, x, y, z, 0.8, 0.08, 1, color);
    for (let i = 0; i < 3; i++)
      box(g, x, y + 0.047, z - 0.25 + i * 0.2, 0.5, 0.015, 0.035, 0x536b78);
    return m;
  }
  function desk(g, x, z, id, active = true) {
    box(g, x, 0.45, z, 1.6, 0.16, 1.3);
    for (const dx of [-0.6, 0.6]) box(g, x + dx, 0.2, z, 0.1, 0.5, 0.9, 0x26333e);
    box(g, x, 0.98, z - 0.35, 1.25, 0.82, 0.12, 0x151d25);
    screens.push(box(g, x, 1, z - 0.275, 1.06, 0.6, 0.025, active ? 0x346758 : 0x35404a));
    for (let i = 0; i < 3; i++)
      box(
        g,
        x - 0.16,
        1.16 - i * 0.15,
        z - 0.25,
        0.63 - i * 0.09,
        0.035,
        0.025,
        active ? 0x99d6bb : 0x64717c,
      );
    box(g, x, 0.56, z + 0.15, 0.8, 0.06, 0.3, 0x27333e);
    sign(g, id, x, 0.3, z + 0.68, 1.45);
  }
  const world = new T.Group();
  scene.add(world);
  const floor = box(scene, 0, -0.45, 1, 27, 0.45, 20, 0x202a34);
  const stations = STATIONS.map((s, i) => {
    const g = new T.Group();
    g.position.set(s.x, 0, s.z);
    g.userData.index = i + 1;
    world.add(g);
    box(g, 0, -0.07, 0, 6.4, 0.45, 6.5, 0x394551);
    box(g, 0, 0.18, 3.1, 5.9, 0.07, 0.09, s.color);
    sign(g, s.name.toUpperCase(), 0, 0.23, 3.29, 5.5);
    return g;
  });
  // Intake: physical storage bays, specification tray and versioned document stack.
  let g = stations[0];
  for (let r = 0; r < 3; r++) {
    box(g, -1.6 + r * 1.5, 1.25, -0.7, 1.15, 2.3, 1.2, 0x263642);
    for (let k = 0; k < 4; k++) {
      box(g, -1.6 + r * 1.5, 0.5 + k * 0.48, -0.04, 0.95, 0.32, 0.08, 0x687988);
      box(g, -1.9 + r * 1.5, 0.5 + k * 0.48, 0.015, 0.09, 0.09, 0.025, 0x78bbcc);
    }
  }
  box(g, 0, 0.4, 1.7, 3.8, 0.3, 1.3);
  for (let i = 0; i < 3; i++) paper(g, -1 + i, 0.61, 1.7);
  sign(g, "SPEC / REPOSITORIES", 0, 2.7, -0.03, 4);
  // Analysis: dependency inspection surface, services and a physical inspection arm.
  g = stations[1];
  box(g, 0, 0.55, 0, 4.7, 0.25, 3.5);
  for (const [x, z] of [
    [-1.3, -0.6],
    [1.3, -0.6],
    [0, 1],
  ]) {
    box(g, x, 0.96, z, 0.85, 0.65, 0.85, 0x80a5bb);
    sign(g, x < 0 ? "API" : x > 0 ? "DATA" : "SERVICE", x, 1, z + 0.44, 0.8);
  }
  box(g, 0, 0.72, -0.6, 2.6, 0.08, 0.08, 0x8ab7c7);
  box(g, 0, 0.72, 0.2, 0.08, 0.08, 1.6, 0x8ab7c7);
  box(g, -2.1, 1.45, -1.3, 0.2, 2, 0.2);
  box(g, -0.9, 2.45, -1.3, 2.6, 0.2, 0.3);
  box(g, 0.2, 2.3, -1.3, 0.6, 0.25, 0.7, 0xa3b6c1);
  // Planning: blueprint bench, physical diagrams, three deliverable trays, approval turnstile.
  g = stations[2];
  box(g, -0.5, 0.8, 0, 3.8, 0.2, 3.6);
  for (const x of [-2, 1]) box(g, x, 0.4, 0, 0.15, 0.8, 3);
  box(g, -0.5, 0.93, 0, 3.3, 0.06, 2.9, 0x385d79);
  for (let i = 0; i < 3; i++) {
    box(g, -1.5 + i, 0.99, -0.5, 0.6, 0.07, 0.5, 0xc7d9df);
    box(g, -1.5 + i, 0.99, 0.45, 0.6, 0.07, 0.5, 0xc7d9df);
  }
  for (let i = 0; i < 3; i++) {
    paper(g, -1.5 + i, 1.04, 1.05);
    sign(g, ["TRD", "SPEC", "PLAN"][i], -1.5 + i, 0.74, 1.82, 0.8);
  }
  box(g, 2, 1.1, 0.3, 0.3, 2, 0.3, 0xbba072);
  gates.push(box(g, 2, 1.9, 0.3, 0.2, 0.12, 2.2, 0xe2bc70));
  sign(g, "HUMAN APPROVAL", 1.7, 2.35, 0.45, 2.4);
  // Jira: three columns of task cards, not a floating generic node.
  g = stations[3];
  for (const x of [-2, 2]) box(g, x, 1.1, -0.8, 0.13, 2.2, 0.2);
  box(g, 0, 1.75, -0.8, 4.7, 2.5, 0.18, 0x273440);
  for (let col = 0; col < 3; col++) {
    sign(g, ["READY", "QUEUED", "LINKED"][col], -1.5 + col * 1.5, 2.7, -0.69, 1.25);
    for (let row = 0; row < 3; row++)
      box(
        g,
        -1.5 + col * 1.5,
        2.2 - row * 0.6,
        -0.63,
        1.1,
        0.43,
        0.12,
        col === 0 ? 0xd2b57d : 0x768794,
      );
  }
  paper(g, 0, 0.4, 1.5);
  // Worktrees: three occupied sample benches and two reserved capacity slots.
  g = stations[4];
  for (let i = 0; i < 5; i++) {
    const x = i < 3 ? -1.9 + i * 1.9 : -1 + (i % 3) * 1.9;
    const z = i < 3 ? -0.95 : 1.3;
    desk(
      g,
      x,
      z,
      i < 3 ? `T-0${i + 1} / DEV-${String.fromCharCode(65 + i)}` : `SLOT ${i + 1} / FREE`,
      i < 3,
    );
  }
  sign(g, "APPROVED PLAN", -2, 2.3, -1, 2);
  box(g, -2, 1.65, -1, 1, 0.2, 1.2, 0x566c65);
  box(g, -2, 1.3, -1, 0.12, 0.6, 0.12);
  paper(g, -2, 1.8, -1);
  box(g, 2.5, 0.7, 2, 1, 0.6, 1.6, 0x49665d);
  for (let i = 0; i < 3; i++) paper(g, 2.5, 1.05 + i * 0.13, 2, 0xb4d6c7);
  sign(g, "SERIAL QUEUE", 1.9, 1.8, 2.5, 2.3);
  // Review is physically independent: inspection arch, integrated payload, human gate.
  g = stations[5];
  box(g, -0.5, 0.5, 0, 3.2, 0.4, 3.7);
  for (const x of [-1.9, 0.9]) box(g, x, 1.65, -0.4, 0.35, 2.3, 0.55, 0x87919f);
  box(g, -0.5, 2.8, -0.4, 3.2, 0.35, 0.55, 0xb1a1b4);
  const scanner = box(g, -0.5, 2.58, -0.4, 2.4, 0.06, 0.5, 0xc998c3);
  box(g, -0.5, 1, 0, 1.4, 0.7, 1.5, 0x92a7b0);
  sign(g, "REV-A / INDEPENDENT", -0.5, 3.2, -0.1, 3.5);
  box(g, 2, 0.9, 1, 0.2, 1.8, 0.2, 0xbba072);
  gates.push(box(g, 2, 1.65, 1, 0.15, 0.12, 2.3, 0xe2bc70));
  sign(g, "HUMAN PR GATE", 1.3, 2.15, 1.6, 2.5);
  // Broad conveyor channels make artifact handoffs part of the shared environment.
  const conveyors = [];
  for (const [a, b] of [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 5],
  ]) {
    const sa = STATIONS[a],
      sb = STATIONS[b],
      vertical = sa.x === sb.x;
    conveyors.push({
      a,
      b,
      mesh: box(
        world,
        (sa.x + sb.x) / 2,
        0.02,
        (sa.z + sb.z) / 2,
        vertical ? 0.9 : 1.6,
        0.18,
        vertical ? 2.5 : 0.9,
        0x64737e,
      ),
    });
  }
  const packet = box(scene, 0, 1, 0, 0.55, 0.18, 0.7, 0xf1cf85);
  packet.visible = false;
  const labelNodes = STATIONS.map((s, i) => {
    const b = document.createElement("button");
    b.textContent = s.name;
    b.className = "dq-world-label";
    b.onclick = () => onSelect(i + 1);
    labels.append(b);
    return b;
  });
  let selected = 0,
    reduced = false,
    yaw = 0.38,
    pitch = 0.78,
    zoom = 1,
    raf = 0,
    disposed = false,
    replayStart = 0,
    transition = true,
    frames = 0,
    totalMs = 0;
  const target = new T.Vector3(),
    wanted = new T.Vector3(),
    desired = new T.Vector3();
  function bounds() {
    const b = new T.Box3().setFromObject(selected ? stations[selected - 1] : world);
    if (selected === 5) b.union(new T.Box3().setFromObject(stations[5]));
    return b;
  }
  function frameTarget() {
    const fit = cameraFrame(bounds(), camera.aspect, yaw, pitch, zoom);
    wanted.copy(fit.center);
    desired.copy(fit.position);
    transition = true;
    request();
  }
  function request() {
    if (!raf && !disposed) raf = requestAnimationFrame(draw);
  }
  function draw(now) {
    raf = 0;
    if (disposed) return;
    const begin = performance.now();
    if (reduced) {
      camera.position.copy(desired);
      target.copy(wanted);
    } else {
      camera.position.lerp(desired, 0.16);
      target.lerp(wanted, 0.16);
    }
    camera.lookAt(target);
    transition = camera.position.distanceTo(desired) > 0.005;
    if (replayStart) {
      const t = Math.min((now - replayStart) / 8500, 1);
      const path =
        selected === 5
          ? [
              [-2, 1.9, -1],
              [-1.9, 1.6, -0.95],
              [-1.9, 1.5, 0.1],
              [2.5, 1.7, 2],
              [-8, 1.6, 0],
            ]
          : selected
            ? [
                [-2, 1.4, 1],
                [0, 1.5, 0],
                [2, 1.6, -0.5],
              ]
            : STATIONS.map((s) => [s.x, 2, s.z]);
      const scaled = t * (path.length - 1),
        idx = Math.min(Math.floor(scaled), path.length - 2),
        v = new T.Vector3(...path[idx]).lerp(new T.Vector3(...path[idx + 1]), scaled - idx);
      if (selected) {
        v.x += STATIONS[selected - 1].x;
        v.z += STATIONS[selected - 1].z;
      }
      packet.position.copy(v);
      packet.visible = true;
      const phases = selected
        ? HANDOFF_LABELS[STATIONS[selected - 1].id]
        : STATIONS.map((s) => s.name);
      onPhase(phases[Math.min(Math.floor(scaled), phases.length - 1)]);
      screens.forEach((screen, i) => {
        screen.scale.y = selected === 5 && i === 0 && scaled >= 1 && scaled < 2 ? 1.08 : 1;
      });
      scanner.position.z =
        selected === 6 || (selected === 5 && scaled >= 3)
          ? -0.4 + Math.sin(t * Math.PI * 4) * 0.7
          : -0.4;
      // Gates stay closed: this example never implies that a human approved anything.
      if (t === 1) {
        replayStart = 0;
        onPhase(phases.at(-1) + " · illustration complete");
      }
    }
    renderer.render(scene, camera);
    if (!loadedMs) loadedMs = performance.now() - started;
    frames++;
    totalMs += performance.now() - begin;
    labelNodes.forEach((el, i) => {
      const v = new T.Vector3(STATIONS[i].x, 3.5, STATIONS[i].z).project(camera);
      const visible = (!selected || selected === i + 1 || (selected === 5 && i === 5)) && v.z < 1;
      el.hidden = !visible;
      el.style.left = `${Math.max(80, Math.min(canvas.clientWidth - 80, ((v.x + 1) / 2) * canvas.clientWidth))}px`;
      el.style.top = `${Math.max(32, Math.min(canvas.clientHeight - 80, ((-v.y + 1) / 2) * canvas.clientHeight))}px`;
    });
    canvas.dataset.metrics = JSON.stringify({
      frames,
      meanSubmitMs: +(totalMs / frames).toFixed(2),
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      loadMs: +loadedMs.toFixed(1),
    });
    if (transition || replayStart) request();
  }
  const resize = new ResizeObserver(() => {
    const w = canvas.clientWidth,
      h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    frameTarget();
  });
  resize.observe(canvas);
  const lost = (e) => {
    e.preventDefault();
    onFail("Graphics context lost. The workflow remains available below.");
  };
  canvas.addEventListener("webglcontextlost", lost);
  function control(action, a = 0, b = 0) {
    if (action === "reset") {
      yaw = 0.38;
      pitch = 0.78;
      zoom = 1;
    }
    if (action === "orbit") {
      yaw = T.MathUtils.clamp(yaw + a, -0.65, 0.8);
      pitch = T.MathUtils.clamp(pitch + b, 0.55, 1.15);
    }
    if (action === "zoom") zoom = T.MathUtils.clamp(zoom + a, 0.75, 1.15);
    if (action === "replay") {
      onPhase(reduced ? "Static handoff · human approval still required" : "Illustrative handoff");
      packet.visible = true;
      replayStart = reduced ? 0 : performance.now();
      if (reduced)
        packet.position.set(
          STATIONS[Math.max(0, selected - 1)].x,
          1.8,
          STATIONS[Math.max(0, selected - 1)].z,
        );
    }
    frameTarget();
  }
  return {
    selectAt(x, y) {
      const ray = new T.Raycaster();
      ray.setFromCamera(new T.Vector2(x, y), camera);
      const hit = ray.intersectObjects(
        stations.filter((station) => station.visible),
        true,
      )[0];
      let object = hit?.object;
      while (object && !object.userData.index) object = object.parent;
      if (object) onSelect(object.userData.index);
    },
    setStage(index, motion) {
      selected = index;
      reduced = motion;
      onPhase("Replay a sample handoff · no application actions");
      replayStart = 0;
      packet.visible = false;
      scanner.position.z = -0.4;
      screens.forEach((screen) => (screen.scale.y = 1));
      conveyors.forEach((c) => (c.mesh.visible = !selected || (selected === 5 && c.a === 4)));
      floor.visible = !selected;
      stations.forEach(
        (g, i) => (g.visible = !selected || i === selected - 1 || (selected === 5 && i === 5)),
      );
      yaw = 0.38;
      pitch = 0.78;
      zoom = 1;
      frameTarget();
    },
    control,
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      resize.disconnect();
      canvas.removeEventListener("webglcontextlost", lost);
      labelNodes.forEach((el) => el.remove());
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
      sun.shadow.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
