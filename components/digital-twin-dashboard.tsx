"use client";

import { useRef, useState } from "react";

import {
  GsplatViewer,
  type GsplatViewerHandle,
  type ViewPreset,
  type ViewerLoadState,
  type ViewerStats,
} from "./gsplat-viewer";

const presetLabels: Array<{
  id: ViewPreset["id"];
  title: string;
  description: string;
}> = [
  {
    id: "front",
    title: "Front",
    description: "Direct elevation framing for immediate orientation.",
  },
  {
    id: "angle",
    title: "Angle",
    description: "A composed diagonal for reading mass and depth.",
  },
  {
    id: "focus",
    title: "Focus",
    description: "A tighter study view for closer inspection.",
  },
];

const initialStats: ViewerStats = {
  backend: "Initializing",
  assetName: "Awaiting capture",
  splatCount: null,
  fps: null,
  status: "Idle",
};

const statusCopy: Record<ViewerStats["status"], string> = {
  Idle: "Awaiting capture",
  Loading: "Processing spatial data",
  Ready: "Live and navigable",
  Error: "Needs attention",
};

function formatSplatCount(count: number | null) {
  if (count === null) return "--";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(2)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;

  return count.toLocaleString();
}

function formatFps(value: number | null) {
  if (value === null) return "--";
  return `${value} FPS`;
}

function statusClassName(status: ViewerStats["status"]) {
  if (status === "Ready") return "text-[#8fd2ff]";
  if (status === "Loading") return "text-[#c7dcff]";
  if (status === "Error") return "text-[#ffb0b7]";
  return "text-white/60";
}

export function DigitalTwinDashboard() {
  const viewerRef = useRef<GsplatViewerHandle | null>(null);
  const [viewerStats, setViewerStats] = useState<ViewerStats>(initialStats);
  const [loadState, setLoadState] = useState<ViewerLoadState>("idle");
  const [activePresetId, setActivePresetId] = useState<ViewPreset["id"] | null>(null);

  const canNavigate = viewerStats.status === "Ready";
  const isBusy = loadState === "loading" || loadState === "framing";

  return (
    <main className="relative min-h-screen overflow-hidden bg-[var(--surface-base)] text-[var(--text-primary)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.12),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(164,138,108,0.12),transparent_30%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(208,186,146,0.55),transparent)]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-5 px-4 py-4 sm:px-6 sm:py-6 xl:flex-row">
        <aside className="w-full shrink-0 rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(22,22,24,0.92),rgba(11,12,14,0.86))] px-6 py-6 shadow-[0_24px_80px_rgba(0,0,0,0.32)] backdrop-blur-2xl xl:min-h-[calc(100vh-3rem)] xl:w-[23rem] xl:px-7 xl:py-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[0.72rem] uppercase tracking-[0.36em] text-[#7aa6ff]">
                Digital twin review
              </p>
              <h1 className="mt-3 font-[family-name:var(--font-display)] text-4xl leading-none text-[var(--text-primary)]">
                AetherView
              </h1>
            </div>
            <div className="rounded-full border border-[rgba(208,186,146,0.22)] bg-[rgba(208,186,146,0.08)] px-3 py-2 text-[0.7rem] uppercase tracking-[0.28em] text-[var(--tone-brass)]">
              v1
            </div>
          </div>

          <p className="mt-5 max-w-sm text-sm leading-7 text-[var(--text-secondary)]">
            A calm, high-trust environment for reviewing Gaussian splat captures without the noise of a demo viewer.
          </p>

          <div className="mt-8 grid grid-cols-2 gap-3">
            <article className="rounded-[1.5rem] border border-white/8 bg-white/[0.03] p-4">
              <p className="text-[0.68rem] uppercase tracking-[0.3em] text-white/42">
                Render path
              </p>
              <p className="mt-3 text-lg font-medium text-white">{viewerStats.backend}</p>
            </article>
            <article className="rounded-[1.5rem] border border-white/8 bg-white/[0.03] p-4">
              <p className="text-[0.68rem] uppercase tracking-[0.3em] text-white/42">
                Splat count
              </p>
              <p className="mt-3 text-lg font-medium text-white">
                {formatSplatCount(viewerStats.splatCount)}
              </p>
            </article>
            <article className="rounded-[1.5rem] border border-white/8 bg-white/[0.03] p-4">
              <p className="text-[0.68rem] uppercase tracking-[0.3em] text-white/42">
                Viewer status
              </p>
              <p className={`mt-3 text-lg font-medium ${statusClassName(viewerStats.status)}`}>
                {statusCopy[viewerStats.status]}
              </p>
            </article>
            <article className="rounded-[1.5rem] border border-white/8 bg-white/[0.03] p-4">
              <p className="text-[0.68rem] uppercase tracking-[0.3em] text-white/42">
                Live frame rate
              </p>
              <p className="mt-3 text-lg font-medium text-white">{formatFps(viewerStats.fps)}</p>
            </article>
          </div>

          <div className="mt-8 rounded-[1.65rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.015))] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[0.68rem] uppercase tracking-[0.3em] text-white/42">
                  Spatial viewpoints
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                  Presets are derived from the loaded capture, so every scan gets balanced, reusable framing.
                </p>
              </div>
              <div className="rounded-full border border-white/8 px-3 py-2 text-[0.7rem] uppercase tracking-[0.28em] text-white/42">
                {canNavigate ? "active" : "idle"}
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {presetLabels.map((preset) => {
                const isActive = activePresetId === preset.id;

                return (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={!canNavigate}
                    className={`flex w-full items-start justify-between rounded-[1.35rem] border px-4 py-4 text-left transition ${
                      isActive
                        ? "border-[#3b82f6]/35 bg-[#3b82f6]/14"
                        : "border-white/8 bg-black/10 hover:border-white/16 hover:bg-white/[0.04]"
                    } disabled:cursor-not-allowed disabled:opacity-45`}
                    onClick={() => {
                      viewerRef.current?.focusPreset(preset.id);
                      setActivePresetId(preset.id);
                    }}
                  >
                    <div>
                      <p className="text-sm font-medium text-white">{preset.title}</p>
                      <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
                        {preset.description}
                      </p>
                    </div>
                    <span className="mt-1 text-[0.68rem] uppercase tracking-[0.28em] text-white/40">
                      jump
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-8 rounded-[1.65rem] border border-[rgba(208,186,146,0.18)] bg-[rgba(208,186,146,0.06)] p-5">
            <p className="text-[0.68rem] uppercase tracking-[0.3em] text-[var(--tone-brass)]">
              Capture intake
            </p>
            <p className="mt-3 text-sm leading-7 text-[var(--text-secondary)]">
              Drag a scan into the viewer or open a local `.ply` / `.sog` file. Optional preprocessing can happen later with `splat-transform`.
            </p>
            <button
              type="button"
              className="mt-5 inline-flex items-center rounded-full border border-[rgba(208,186,146,0.25)] bg-[rgba(208,186,146,0.1)] px-5 py-3 text-sm font-medium text-white transition hover:bg-[rgba(208,186,146,0.16)]"
              onClick={() => viewerRef.current?.openFilePicker()}
            >
              {isBusy ? "Capture in progress..." : "Choose capture file"}
            </button>
          </div>

          <div className="mt-8 border-t border-white/8 pt-5">
            <p className="text-[0.68rem] uppercase tracking-[0.3em] text-white/42">
              Active file
            </p>
            <p className="mt-3 break-all text-sm leading-7 text-white/78">
              {viewerStats.assetName}
            </p>
          </div>
        </aside>

        <section className="relative flex min-h-[70vh] flex-1 flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(12,13,15,0.75),rgba(8,9,10,0.9))] shadow-[0_32px_90px_rgba(0,0,0,0.34)]">
          <div className="relative z-10 flex flex-col gap-3 border-b border-white/8 px-5 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-7">
            <div>
              <p className="text-[0.68rem] uppercase tracking-[0.34em] text-[#7aa6ff]">
                Immersive viewport
              </p>
              <h2 className="mt-3 font-[family-name:var(--font-display)] text-3xl leading-none text-white sm:text-[2.6rem]">
                Architectural scan review without leaving the browser.
              </h2>
            </div>
            <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.25em] text-white/46">
              <span className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-2">
                Client-side
              </span>
              <span className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-2">
                WebGPU priority
              </span>
              <span className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-2">
                No extra repo clone
              </span>
            </div>
          </div>

          <div className="relative flex-1 p-3 sm:p-4">
            <GsplatViewer
              ref={viewerRef}
              onStatsChange={(stats) => setViewerStats(stats)}
              onStateChange={(state) => setLoadState(state)}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
