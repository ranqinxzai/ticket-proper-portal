"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Star } from "lucide-react";

import type { WfStatus, WfTransition } from "@/lib/itsm/admin-types";

/** A selection on the canvas — either a status node or a transition edge. */
export type CanvasSelection =
  | { kind: "status"; id: string }
  | { kind: "transition"; id: string }
  | null;

const NODE_W = 168;
const NODE_H = 64;

type Point = { x: number; y: number };

/** Center of a node from its top-left canvas coords. */
function centerOf(s: WfStatus): Point {
  return { x: s.canvas_x + NODE_W / 2, y: s.canvas_y + NODE_H / 2 };
}

/**
 * Intersection of the segment from `from`→`to` with the rectangle around `to`,
 * so arrows terminate on the node border rather than its center.
 */
function borderPoint(from: Point, to: Point, halfW: number, halfH: number): Point {
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  if (dx === 0 && dy === 0) return to;
  const scaleX = dx === 0 ? Infinity : halfW / Math.abs(dx);
  const scaleY = dy === 0 ? Infinity : halfH / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return { x: to.x + dx * scale, y: to.y + dy * scale };
}

export function WorkflowCanvas({
  statuses,
  transitions,
  selection,
  addTransitionMode,
  pendingSource,
  onSelect,
  onNodeMoved,
  onNodeClickInAddMode,
}: {
  statuses: WfStatus[];
  transitions: WfTransition[];
  selection: CanvasSelection;
  /** When true, clicking nodes wires up a new transition instead of selecting. */
  addTransitionMode: boolean;
  /** The status id chosen as the source while in add-transition mode. */
  pendingSource: string | null;
  onSelect: (sel: CanvasSelection) => void;
  onNodeMoved: (id: string, x: number, y: number) => void;
  onNodeClickInAddMode: (id: string) => void;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{
    id: string;
    offsetX: number;
    offsetY: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);

  const byId = useMemo(() => {
    const m = new Map<string, WfStatus>();
    for (const s of statuses) m.set(s.id, s);
    return m;
  }, [statuses]);

  // Live position for a node (drag overrides persisted coords).
  const posOf = useCallback(
    (s: WfStatus): Point => {
      if (drag && drag.id === s.id) return { x: drag.x, y: drag.y };
      return { x: s.canvas_x, y: s.canvas_y };
    },
    [drag],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent, s: WfStatus) => {
      if (addTransitionMode) return; // clicks handled in onClick for wiring
      if (e.button !== 0) return;
      const surface = surfaceRef.current;
      if (!surface) return;
      const rect = surface.getBoundingClientRect();
      const pointerX = e.clientX - rect.left + surface.scrollLeft;
      const pointerY = e.clientY - rect.top + surface.scrollTop;
      (e.target as Element).setPointerCapture(e.pointerId);
      setDrag({
        id: s.id,
        offsetX: pointerX - s.canvas_x,
        offsetY: pointerY - s.canvas_y,
        x: s.canvas_x,
        y: s.canvas_y,
        moved: false,
      });
    },
    [addTransitionMode],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag) return;
      const surface = surfaceRef.current;
      if (!surface) return;
      const rect = surface.getBoundingClientRect();
      const pointerX = e.clientX - rect.left + surface.scrollLeft;
      const pointerY = e.clientY - rect.top + surface.scrollTop;
      const nextX = Math.max(0, pointerX - drag.offsetX);
      const nextY = Math.max(0, pointerY - drag.offsetY);
      setDrag((d) =>
        d ? { ...d, x: nextX, y: nextY, moved: d.moved || Math.abs(nextX - d.x) > 1 || Math.abs(nextY - d.y) > 1 } : d,
      );
    },
    [drag],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent, s: WfStatus) => {
      if (!drag || drag.id !== s.id) return;
      try {
        (e.target as Element).releasePointerCapture(e.pointerId);
      } catch {
        /* capture may already be gone */
      }
      const moved = drag.moved;
      const finalX = Math.round(drag.x);
      const finalY = Math.round(drag.y);
      setDrag(null);
      if (moved) {
        onNodeMoved(s.id, finalX, finalY);
      } else {
        onSelect({ kind: "status", id: s.id });
      }
    },
    [drag, onNodeMoved, onSelect],
  );

  // Canvas extent — fit all nodes plus padding.
  const { width, height } = useMemo(() => {
    let maxX = 800;
    let maxY = 480;
    for (const s of statuses) {
      const p = drag && drag.id === s.id ? { x: drag.x, y: drag.y } : { x: s.canvas_x, y: s.canvas_y };
      maxX = Math.max(maxX, p.x + NODE_W + 80);
      maxY = Math.max(maxY, p.y + NODE_H + 80);
    }
    return { width: maxX, height: maxY };
  }, [statuses, drag]);

  // Split transitions: "create" / global ones are rendered as chips, the rest as edges.
  const edgeTransitions = transitions.filter((t) => t.from_status && !t.is_global);
  const chipTransitions = transitions.filter((t) => !t.from_status || t.is_global);

  return (
    <div
      ref={surfaceRef}
      className="relative h-[calc(100vh-220px)] min-h-[420px] overflow-auto rounded-lg border bg-slate-50"
      style={{
        backgroundImage:
          "radial-gradient(circle, rgb(203 213 225 / 0.5) 1px, transparent 1px)",
        backgroundSize: "20px 20px",
      }}
      onClick={(e) => {
        // Click on empty surface clears selection.
        if (e.target === e.currentTarget) onSelect(null);
      }}
    >
      <div className="relative" style={{ width, height }}>
        {/* Edges layer */}
        <svg
          className="pointer-events-none absolute inset-0"
          width={width}
          height={height}
          aria-hidden
        >
          <defs>
            <marker
              id="wf-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#6366f1" />
            </marker>
            <marker
              id="wf-arrow-sel"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#4f46e5" />
            </marker>
          </defs>

          {edgeTransitions.map((t) => {
            const from = byId.get(t.from_status as string);
            const to = byId.get(t.to_status);
            if (!from || !to) return null;
            const fc = drag && drag.id === from.id ? { x: drag.x + NODE_W / 2, y: drag.y + NODE_H / 2 } : centerOf(from);
            const tcRaw = drag && drag.id === to.id ? { x: drag.x + NODE_W / 2, y: drag.y + NODE_H / 2 } : centerOf(to);
            const start = borderPoint(tcRaw, fc, NODE_W / 2 + 2, NODE_H / 2 + 2);
            const end = borderPoint(fc, tcRaw, NODE_W / 2 + 8, NODE_H / 2 + 8);
            const selected = selection?.kind === "transition" && selection.id === t.id;
            return (
              <line
                key={t.id}
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                stroke={selected ? "#4f46e5" : "#94a3b8"}
                strokeWidth={selected ? 2.5 : 1.75}
                markerEnd={selected ? "url(#wf-arrow-sel)" : "url(#wf-arrow)"}
              />
            );
          })}
        </svg>

        {/* Edge labels (clickable, above the SVG) */}
        {edgeTransitions.map((t) => {
          const from = byId.get(t.from_status as string);
          const to = byId.get(t.to_status);
          if (!from || !to) return null;
          const fc = drag && drag.id === from.id ? { x: drag.x + NODE_W / 2, y: drag.y + NODE_H / 2 } : centerOf(from);
          const tc = drag && drag.id === to.id ? { x: drag.x + NODE_W / 2, y: drag.y + NODE_H / 2 } : centerOf(to);
          const mid = { x: (fc.x + tc.x) / 2, y: (fc.y + tc.y) / 2 };
          const selected = selection?.kind === "transition" && selection.id === t.id;
          return (
            <button
              key={`lbl-${t.id}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelect({ kind: "transition", id: t.id });
              }}
              className={[
                "absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium shadow-sm transition",
                selected
                  ? "border-indigo-400 bg-indigo-600 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-700",
              ].join(" ")}
              style={{ left: mid.x, top: mid.y }}
            >
              {t.name || "(unnamed)"}
              {t.post_functions.length > 0 && (
                <span className={selected ? "ml-1 opacity-80" : "ml-1 text-indigo-500"}>
                  ƒ{t.post_functions.length}
                </span>
              )}
            </button>
          );
        })}

        {/* Global / create chips near their target node */}
        {chipTransitions.map((t) => {
          const to = byId.get(t.to_status);
          if (!to) return null;
          const tc = drag && drag.id === to.id ? { x: drag.x, y: drag.y } : { x: to.canvas_x, y: to.canvas_y };
          const selected = selection?.kind === "transition" && selection.id === t.id;
          const label = !t.from_status ? `▶ ${t.name || "Create"}` : `⟳ ${t.name || "Global"}`;
          return (
            <button
              key={`chip-${t.id}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelect({ kind: "transition", id: t.id });
              }}
              className={[
                "absolute z-10 -translate-y-full whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium shadow-sm transition",
                selected
                  ? "border-indigo-400 bg-indigo-600 text-white"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-400",
              ].join(" ")}
              style={{ left: tc.x, top: tc.y - 4 }}
              title={!t.from_status ? "Create transition into initial status" : "Global transition"}
            >
              {label}
            </button>
          );
        })}

        {/* Status nodes */}
        {statuses.map((s) => {
          const p = posOf(s);
          const selected = selection?.kind === "status" && selection.id === s.id;
          const isPendingSource = pendingSource === s.id;
          const dragging = drag?.id === s.id;
          return (
            <div
              key={s.id}
              onPointerDown={(e) => onPointerDown(e, s)}
              onPointerMove={onPointerMove}
              onPointerUp={(e) => onPointerUp(e, s)}
              onClick={(e) => {
                e.stopPropagation();
                if (addTransitionMode) onNodeClickInAddMode(s.id);
              }}
              className={[
                "group absolute flex flex-col justify-center rounded-lg border-2 bg-white px-3 py-2 shadow-sm transition-shadow",
                addTransitionMode ? "cursor-crosshair" : dragging ? "cursor-grabbing" : "cursor-grab",
                selected ? "ring-2 ring-indigo-500 ring-offset-1" : "",
                isPendingSource ? "ring-2 ring-emerald-500 ring-offset-1" : "",
                dragging ? "shadow-lg" : "",
              ].join(" ")}
              style={{
                left: p.x,
                top: p.y,
                width: NODE_W,
                height: NODE_H,
                borderColor: s.color || "#cbd5e1",
                touchAction: "none",
              }}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: s.color || "#94a3b8" }}
                />
                <span className="truncate text-sm font-medium text-slate-800">{s.name}</span>
                {s.is_initial && <Star className="ml-auto h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500" />}
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <span
                  className={[
                    "rounded px-1.5 py-0.5 text-[10px] font-medium capitalize",
                    s.category_key === "done"
                      ? "bg-emerald-100 text-emerald-700"
                      : s.category_key === "in_progress"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-slate-100 text-slate-600",
                  ].join(" ")}
                >
                  {(s.category_key || "todo").replace("_", " ")}
                </span>
                <span className="truncate font-mono text-[10px] text-slate-400">{s.key}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
