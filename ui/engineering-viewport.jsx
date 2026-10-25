import React, { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./use-reduced-motion";
export function bindSceneWheel(canvas, onZoom) {
  const handleWheel = (event) => {
    if (canvas.ownerDocument.activeElement !== canvas || event.ctrlKey || !event.deltaY) return;
    event.preventDefault();
    onZoom(event.deltaY > 0 ? -0.05 : 0.05);
  };
  // React wheel listeners are passive, so cancellation needs a native listener.
  canvas.addEventListener("wheel", handleWheel, { passive: false });
  return () => canvas.removeEventListener("wheel", handleWheel);
}

export function EngineeringViewport({ stageIndex = 0, onSelectStage = () => {} }) {
  const canvas = useRef(null),
    labels = useRef(null),
    engine = useRef(null),
    latest = useRef({ stageIndex, onSelectStage }),
    drag = useRef(null);
  const reduced = useReducedMotion(),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [phase, setPhase] = useState("Replay a sample handoff · no application actions");
  latest.current = { stageIndex, onSelectStage, reduced };
  useEffect(() => {
    let cancelled = false;
    import("./engineering-scene")
      .then(({ createEngineeringScene }) => {
        if (cancelled) return;
        try {
          engine.current = createEngineeringScene(
            canvas.current,
            labels.current,
            (i) => latest.current.onSelectStage(i),
            setError,
            setPhase,
          );
          engine.current.setStage(latest.current.stageIndex, latest.current.reduced);
          setReady(true);
        } catch {
          setError(
            "3D graphics are unavailable. Explore the workflow using the stage buttons and descriptions.",
          );
        }
      })
      .catch(() => setError("The 3D scene could not load. Stage descriptions remain available."));
    return () => {
      cancelled = true;
      engine.current?.dispose();
      engine.current = null;
    };
  }, []);
  useEffect(() => {
    if (error) {
      engine.current?.dispose();
      engine.current = null;
    }
  }, [error]);
  useEffect(() => {
    engine.current?.setStage(stageIndex, reduced);
  }, [stageIndex, reduced]);
  useEffect(() => {
    if (!ready || error || !canvas.current) return;
    return bindSceneWheel(canvas.current, (delta) => engine.current?.control("zoom", delta));
  }, [ready, error]);
  const control = (...args) => engine.current?.control(...args);
  return (
    <div className="dq-engineering-viewport">
      <span className="dq-scene-disclosure">Illustrated workflow · no live agents</span>
      {error ? (
        <div role="status" className="dq-scene-fallback">
          <h3>Engineering workflow</h3>
          <p>{error}</p>
          <ol>
            {[
              "Intake & repositories",
              "Repository analysis",
              "TRD & planning",
              "Jira backlog",
              "Isolated worktrees",
              "Independent review & PR",
            ].map((name, i) => (
              <li key={name}>
                <button onClick={() => onSelectStage(i + 1)}>{name}</button>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <>
          {!ready && (
            <p className="dq-scene-loading" role="status">
              Loading engineering scene…
            </p>
          )}
          <canvas
            ref={canvas}
            className="dq-onboarding-canvas"
            tabIndex={0}
            aria-label="Engineering diorama. Arrow keys orbit, plus and minus zoom, R resets."
            onPointerDown={(e) => {
              drag.current = { x: e.clientX, y: e.clientY, originX: e.clientX, originY: e.clientY };
              e.currentTarget.setPointerCapture(e.pointerId);
              e.currentTarget.focus();
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              control(
                "orbit",
                (e.clientX - drag.current.x) * 0.006,
                (e.clientY - drag.current.y) * 0.006,
              );
              drag.current = { ...drag.current, x: e.clientX, y: e.clientY };
            }}
            onPointerUp={(e) => {
              if (
                drag.current &&
                Math.hypot(e.clientX - drag.current.originX, e.clientY - drag.current.originY) < 5
              ) {
                const rect = e.currentTarget.getBoundingClientRect();
                engine.current?.selectAt(
                  ((e.clientX - rect.left) / rect.width) * 2 - 1,
                  (-(e.clientY - rect.top) / rect.height) * 2 + 1,
                );
              }
              drag.current = null;
            }}
            onPointerCancel={() => (drag.current = null)}
            onKeyDown={(e) => {
              const controls = {
                ArrowLeft: ["orbit", -0.1, 0],
                ArrowRight: ["orbit", 0.1, 0],
                ArrowUp: ["orbit", 0, 0.1],
                ArrowDown: ["orbit", 0, -0.1],
                "+": ["zoom", 0.1],
                "=": ["zoom", 0.1],
                "-": ["zoom", -0.1],
                r: ["reset"],
                Home: ["reset"],
              };
              if (controls[e.key]) {
                e.preventDefault();
                control(...controls[e.key]);
              }
            }}
          />
          <div ref={labels} className="dq-world-labels" />
        </>
      )}
      <p className="dq-world-phase" aria-live="polite">
        {phase}
      </p>
      <div className="dq-world-controls" aria-label="Scene controls">
        <button onClick={() => control("zoom", -0.1)} disabled={!!error} aria-label="Zoom out">
          −
        </button>
        <button onClick={() => control("zoom", 0.1)} disabled={!!error} aria-label="Zoom in">
          +
        </button>
        <button onClick={() => control("reset")} disabled={!!error}>
          Reset view
        </button>
        <button onClick={() => control("replay")} disabled={!!error}>
          {reduced ? "Show handoff" : "Replay handoff"}
        </button>
      </div>
      <p className="dq-world-help">
        Drag to orbit · Focus scene for keyboard controls
        {reduced ? " · Reduced motion enabled" : ""}
      </p>
    </div>
  );
}
