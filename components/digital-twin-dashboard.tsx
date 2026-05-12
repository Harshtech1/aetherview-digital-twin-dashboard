"use client";

import Image from "next/image";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "framer-motion";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";

import { useFocusStack } from "@/hooks/use-focus-stack";
import type {
  DiagnosticsConfig,
  ViewPreset,
  ViewerDisplayStatus,
  ViewerLoadState,
  ViewerStats,
} from "@/types/spatial";

import { GsplatViewer, type GsplatViewerHandle } from "./gsplat-viewer";

type HudPanelId =
  | "identity"
  | "viewpoints"
  | "stats"
  | "utility"
  | "diagnostics";

const DESKTOP_PANEL_IDS = [
  "identity",
  "viewpoints",
  "stats",
  "utility",
  "diagnostics",
] as const satisfies readonly HudPanelId[];

const desktopMetricClass =
  "rounded-[1.2rem] bg-white/[0.045] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]";

interface DigitalTwinDashboardProps {
  assetUrl?: string;
  assetName?: string;
  roomPresets: ViewPreset[];
  initialPresetId?: string;
  diagnostics?: DiagnosticsConfig;
}

function formatSplatCount(count: number | null): string {
  if (count === null)
    return "--";

  if (count >= 1_000_000)
    return `${(count / 1_000_000).toFixed(2)}M`;

  if (count >= 1_000)
    return `${(count / 1_000).toFixed(1)}K`;

  return count.toLocaleString();
}

function formatFps(value: number | null): string {
  return value === null ? "--" : `${value} FPS`;
}

function formatGpuMemory(value: number | null): string {
  return value === null ? "--" : `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function getViewerDisplayStatus(status: ViewerLoadState): ViewerDisplayStatus {
  if (status === "ready")
    return "Ready";

  if (status === "loading" || status === "framing")
    return "Loading";

  if (status === "error")
    return "Error";

  return "Idle";
}

function statusDotClassName(status: ViewerStats["status"]): string {
  if (status === "ready")
    return "bg-[#d8e4ff] shadow-[0_0_18px_rgba(142,168,255,0.62)]";

  if (status === "loading" || status === "framing")
    return "bg-[var(--tone-brass)] shadow-[0_0_18px_rgba(212,190,152,0.44)]";

  if (status === "error")
    return "bg-[#ffb0b7] shadow-[0_0_18px_rgba(255,176,183,0.48)]";

  return "bg-white/38";
}

export function DigitalTwinDashboard({
  assetUrl,
  assetName,
  roomPresets,
  initialPresetId,
  diagnostics,
}: DigitalTwinDashboardProps): JSX.Element {
  const shouldReduceMotion = useReducedMotion();
  const viewerRef = useRef<GsplatViewerHandle | null>(null);
  const copyFeedbackTimeoutRef = useRef<number | null>(null);
  const focusStack = useFocusStack<HudPanelId>(DESKTOP_PANEL_IDS);
  const [viewerStats, setViewerStats] = useState<ViewerStats>({
    backend: "Initializing",
    assetName: assetName ?? "Awaiting capture",
    splatCount: null,
    fps: null,
    gpuMemoryBytes: null,
    renderQuality: "Balanced",
    diagnosticsVisible: diagnostics?.enabledByDefault ?? false,
    fallbackMode: false,
    status: "idle",
  });
  const [loadState, setLoadState] = useState<ViewerLoadState>("idle");
  const [activePresetId, setActivePresetId] = useState<string | null>(
    initialPresetId ?? roomPresets[0]?.id ?? null,
  );
  const [hoveredPresetId, setHoveredPresetId] = useState<string | null>(null);
  const [previewFailures, setPreviewFailures] = useState<Record<string, boolean>>(
    {},
  );
  const [previewTilt, setPreviewTilt] = useState({ rotateX: 0, rotateY: 0 });
  const [isViewpointTransitioning, setIsViewpointTransitioning] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }
    };
  }, []);

  const panelSpring = shouldReduceMotion
    ? { duration: 0.01 }
    : { type: "spring" as const, stiffness: 82, damping: 18, mass: 0.92 };
  const detailEase = shouldReduceMotion
    ? { duration: 0.01 }
    : { duration: 0.34, ease: [0.22, 1, 0.36, 1] as const };

  const activePreset = useMemo(
    () =>
      roomPresets.find((preset) => preset.id === activePresetId) ??
      roomPresets[0] ??
      null,
    [activePresetId, roomPresets],
  );
  const previewPreset = useMemo(
    () =>
      roomPresets.find((preset) => preset.id === hoveredPresetId) ?? null,
    [hoveredPresetId, roomPresets],
  );

  const canNavigate = viewerStats.status === "ready" && roomPresets.length > 0;
  const isBusy = loadState === "loading" || loadState === "framing";
  const displayStatus = getViewerDisplayStatus(viewerStats.status);
  const statusLabel =
    viewerStats.status === "idle"
      ? assetUrl
        ? "Queued for load"
        : "Awaiting capture"
      : viewerStats.status === "loading" || viewerStats.status === "framing"
        ? "Processing spatial data"
        : viewerStats.status === "ready"
          ? "Viewport live"
          : "Needs attention";

  const getDesktopPanelClassName = (panelId: HudPanelId, extraClassName: string) => {
    const panelState = focusStack.getPanelState(panelId);

    return [
      "hud-panel pointer-events-auto",
      panelState.isActive
        ? "hud-panel-active"
        : panelState.isDimmed
          ? "hud-panel-dimmed"
          : "hud-panel-resting",
      extraClassName,
    ].join(" ");
  };

  const revealCopyFeedback = (message: string) => {
    setCopyFeedback(message);

    if (copyFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(copyFeedbackTimeoutRef.current);
    }

    copyFeedbackTimeoutRef.current = window.setTimeout(() => {
      setCopyFeedback(null);
      copyFeedbackTimeoutRef.current = null;
    }, 2200);
  };

  const handleCopyCurrentView = () => {
    const snapshot = viewerRef.current?.copyCurrentView();
    if (!snapshot)
      return;

    revealCopyFeedback("Copied / Logged");
  };

  const resetPreviewState = () => {
    setHoveredPresetId(null);
    setPreviewTilt({ rotateX: 0, rotateY: 0 });
  };

  const handlePreviewPointerMove = (
    event: MouseEvent<HTMLButtonElement>,
    presetId: string,
  ) => {
    setHoveredPresetId(presetId);

    if (shouldReduceMotion)
      return;

    const { currentTarget, clientX, clientY } = event;
    const bounds = currentTarget.getBoundingClientRect();
    const normalizedX = (clientX - bounds.left) / bounds.width - 0.5;
    const normalizedY = (clientY - bounds.top) / bounds.height - 0.5;

    setPreviewTilt({
      rotateX: -normalizedY * 10,
      rotateY: normalizedX * 14,
    });
  };

  const renderPreviewCard = () => {
    if (!previewPreset)
      return null;

    const shouldRenderFallback =
      previewFailures[previewPreset.id] || !previewPreset.previewImageSrc;

    return (
      <AnimatePresence>
        <motion.aside
          aria-hidden="true"
          key={previewPreset.id}
          initial={
            shouldReduceMotion
              ? false
              : { opacity: 0, x: -10, scale: 0.96, filter: "blur(10px)" }
          }
          animate={{
            opacity: 1,
            x: 0,
            scale: 1,
            filter: "blur(0px)",
            rotateX: shouldReduceMotion ? 0 : previewTilt.rotateX,
            rotateY: shouldReduceMotion ? 0 : previewTilt.rotateY,
            y: shouldReduceMotion ? 0 : -2,
          }}
          exit={
            shouldReduceMotion
              ? { opacity: 0 }
              : { opacity: 0, x: -10, scale: 0.96, filter: "blur(10px)" }
          }
          transition={panelSpring}
          className="pointer-events-none absolute bottom-0 left-[calc(100%+1rem)] hidden w-[16rem] lg:block"
          style={{ transformPerspective: 1200 }}
        >
          <div className="hud-preview-card overflow-hidden p-3">
            {shouldRenderFallback ? (
              <div className="rounded-[1.2rem] bg-[linear-gradient(180deg,rgba(26,33,42,0.96),rgba(13,15,19,0.96))] p-5">
                <div className="h-28 rounded-[1rem] bg-[radial-gradient(circle_at_top,rgba(142,168,255,0.24),transparent_46%),linear-gradient(180deg,rgba(37,49,66,0.92),rgba(16,17,21,0.92))]" />
                <p className="mt-4 text-[0.68rem] uppercase tracking-[0.32em] text-[var(--tone-brass)]">
                  Taskbar preview
                </p>
                <p className="mt-2 font-[family-name:var(--font-display)] text-2xl tracking-[-0.04em] text-white">
                  {previewPreset.label}
                </p>
                <p className="mt-2 text-sm leading-6 text-white/62">
                  {previewPreset.previewCaption ??
                    "Preview unavailable. Use the room label and metadata until a thumbnail is provided."}
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-[1.2rem]">
                <Image
                  src={previewPreset.previewImageSrc}
                  alt={previewPreset.previewAlt ?? `${previewPreset.label} preview`}
                  width={256}
                  height={160}
                  unoptimized
                  className="h-36 w-full object-cover"
                  onError={() =>
                    setPreviewFailures((currentFailures) => ({
                      ...currentFailures,
                      [previewPreset.id]: true,
                    }))
                  }
                />
                <div className="bg-[linear-gradient(180deg,rgba(20,22,26,0.94),rgba(10,11,14,0.96))] px-4 py-4">
                  <p className="text-[0.68rem] uppercase tracking-[0.32em] text-[var(--tone-brass)]">
                    Taskbar preview
                  </p>
                  <p className="mt-2 font-[family-name:var(--font-display)] text-2xl tracking-[-0.04em] text-white">
                    {previewPreset.label}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-white/62">
                    {previewPreset.previewCaption ?? previewPreset.description}
                  </p>
                </div>
              </div>
            )}
          </div>
        </motion.aside>
      </AnimatePresence>
    );
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[var(--surface-base)] font-[family-name:var(--font-body)] text-[var(--text-primary)]">
      <div className="absolute inset-0 z-0">
        <GsplatViewer
          ref={viewerRef}
          assetUrl={assetUrl}
          assetName={assetName}
          presets={roomPresets}
          initialPresetId={initialPresetId}
          diagnostics={diagnostics}
          onStatsChange={setViewerStats}
          onStateChange={setLoadState}
          onViewpointMotionChange={setIsViewpointTransitioning}
          onViewportInteract={focusStack.resetFocus}
        />
      </div>

      <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(180deg,rgba(4,5,8,0.1),rgba(4,5,8,0.04)_30%,rgba(4,5,8,0.18))]" />

      <div className="pointer-events-none absolute inset-0 z-20 hidden lg:block">
        <motion.section
          {...focusStack.getPanelProps("identity")}
          tabIndex={0}
          initial={false}
          animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
          transition={{
            ...panelSpring,
            delay: shouldReduceMotion ? 0 : 0,
          }}
          style={{ zIndex: focusStack.getPanelState("identity").zIndex }}
          className={getDesktopPanelClassName(
            "identity",
            "absolute left-[var(--hud-edge-padding)] top-[var(--hud-edge-padding)] w-[20.5rem] px-6 py-6",
          )}
        >
          <p className="text-[0.68rem] uppercase tracking-[0.36em] text-[#7f9dcb]">
            Digital twin review
          </p>
          <h1 className="mt-3 font-[family-name:var(--font-display)] text-[3rem] leading-none tracking-[-0.06em] text-white">
            AetherView
          </h1>
          <p className="mt-4 max-w-[16rem] text-sm leading-7 text-[var(--text-secondary)]">
            Spatial operating surfaces tuned for cinematic review and room-level calibration.
          </p>
          <div className="mt-7 flex items-center gap-3">
            <span
              className={`h-2.5 w-2.5 rounded-full ${statusDotClassName(viewerStats.status)}`}
            />
            <p className="text-lg font-medium text-white">{statusLabel}</p>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <span className="glass-chip px-3 py-2 text-[0.7rem] uppercase tracking-[0.28em] text-[var(--tone-brass)]">
              {viewerStats.backend}
            </span>
            <span className="glass-chip px-3 py-2 text-[0.7rem] uppercase tracking-[0.28em] text-white/54">
              {viewerStats.fallbackMode ? "Compatibility path" : `${displayStatus} view`}
            </span>
          </div>
          <div className="mt-6 grid gap-4 text-sm text-white/76">
            <div>
              <p className="text-[0.62rem] uppercase tracking-[0.3em] text-white/38">
                Active viewpoint
              </p>
              <p className="mt-2 text-[1rem] text-white">
                {activePreset?.label ?? "Standby"}
              </p>
            </div>
            <div>
              <p className="text-[0.62rem] uppercase tracking-[0.3em] text-white/38">
                Scene source
              </p>
              <p className="mt-2 break-all text-[0.94rem] text-white/72">
                {viewerStats.assetName}
              </p>
            </div>
          </div>
        </motion.section>

        <motion.section
          {...focusStack.getPanelProps("viewpoints")}
          tabIndex={0}
          initial={false}
          animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
          transition={{
            ...panelSpring,
            delay: shouldReduceMotion ? 0 : 0.2,
          }}
          style={{ zIndex: focusStack.getPanelState("viewpoints").zIndex }}
          className={getDesktopPanelClassName(
            "viewpoints",
            "absolute bottom-[var(--hud-edge-padding)] left-[var(--hud-edge-padding)] w-[24rem] overflow-visible px-5 py-5",
          )}
        >
          <div className="relative">
            <p className="text-[0.68rem] uppercase tracking-[0.32em] text-white/42">
              Viewpoint rail
            </p>
            <p className="mt-2 max-w-[16rem] text-sm leading-6 text-[var(--text-secondary)]">
              Hover for a preview card. Click to move, then use diagnostics to capture exact calibration coordinates.
            </p>
            <div className="mt-5 space-y-3">
              {roomPresets.map((preset) => {
                const isActive = activePresetId === preset.id;

                return (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={!canNavigate}
                    className={`focus-ring w-full rounded-[1.35rem] px-4 py-4 text-left transition-all duration-300 ease-out ${
                      isActive
                        ? "bg-white/[0.1] shadow-[0_18px_42px_rgba(0,0,0,0.24),inset_0_0_0_1px_rgba(212,190,152,0.12)]"
                        : "bg-white/[0.04] hover:bg-white/[0.07] hover:shadow-[0_16px_34px_rgba(0,0,0,0.18)]"
                    } disabled:cursor-not-allowed disabled:opacity-45`}
                    onMouseEnter={() => setHoveredPresetId(preset.id)}
                    onMouseLeave={resetPreviewState}
                    onMouseMove={(event) => handlePreviewPointerMove(event, preset.id)}
                    onFocus={() => setHoveredPresetId(preset.id)}
                    onBlur={resetPreviewState}
                    onClick={() => {
                      viewerRef.current?.focusPreset(preset.id);
                      setActivePresetId(preset.id);
                    }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[1rem] font-medium text-white">{preset.label}</p>
                        <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                          {preset.description}
                        </p>
                      </div>
                      <span className="pt-1 text-[0.68rem] uppercase tracking-[0.28em] text-white/34">
                        {isActive ? "Live" : "Jump"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
            {renderPreviewCard()}
          </div>
        </motion.section>

        <motion.section
          {...focusStack.getPanelProps("stats")}
          tabIndex={0}
          initial={false}
          animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
          transition={{
            ...panelSpring,
            delay: shouldReduceMotion ? 0 : 0.4,
          }}
          style={{ zIndex: focusStack.getPanelState("stats").zIndex }}
          className={getDesktopPanelClassName(
            "stats",
            "absolute right-[var(--hud-edge-padding)] top-[var(--hud-edge-padding)] w-[20rem] px-5 py-5",
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[0.68rem] uppercase tracking-[0.32em] text-white/42">
                Runtime telemetry
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                Live rendering state, performance, and camera motion cues.
              </p>
            </div>
            <span className="glass-chip px-3 py-2 text-[0.7rem] uppercase tracking-[0.28em] text-white/48">
              {isViewpointTransitioning ? "Moving" : "Settled"}
            </span>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <article className={desktopMetricClass}>
              <p className="text-[0.62rem] uppercase tracking-[0.28em] text-white/38">
                Render path
              </p>
              <p className="mt-3 text-[1.05rem] text-white">{viewerStats.backend}</p>
            </article>
            <article className={desktopMetricClass}>
              <p className="text-[0.62rem] uppercase tracking-[0.28em] text-white/38">
                Splat count
              </p>
              <p className="mt-3 text-[1.05rem] text-white">
                {formatSplatCount(viewerStats.splatCount)}
              </p>
            </article>
            <article className={desktopMetricClass}>
              <p className="text-[0.62rem] uppercase tracking-[0.28em] text-white/38">
                Live frame rate
              </p>
              <p className="mt-3 text-[1.05rem] text-white">{formatFps(viewerStats.fps)}</p>
            </article>
            <article className={desktopMetricClass}>
              <p className="text-[0.62rem] uppercase tracking-[0.28em] text-white/38">
                Viewer status
              </p>
              <p className="mt-3 text-[1.05rem] text-white">{statusLabel}</p>
            </article>
          </div>
        </motion.section>

        <motion.section
          {...focusStack.getPanelProps("utility")}
          tabIndex={0}
          initial={false}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{
            ...panelSpring,
            delay: shouldReduceMotion ? 0 : 0.6,
          }}
          style={{ zIndex: focusStack.getPanelState("utility").zIndex }}
          className={getDesktopPanelClassName(
            "utility",
            "absolute bottom-[var(--hud-edge-padding)] right-[var(--hud-edge-padding)] w-[20rem] px-5 py-5",
          )}
        >
          <p className="text-[0.68rem] uppercase tracking-[0.32em] text-[var(--tone-brass)]">
            Intake dock
          </p>
          <p className="mt-3 text-sm leading-7 text-[var(--text-secondary)]">
            Replace the active scene, validate fallback behavior, or use the diagnostic panel for exact camera calibration.
          </p>
          <button
            type="button"
            className="focus-ring mt-5 inline-flex items-center rounded-full bg-[rgba(212,190,152,0.12)] px-5 py-3 text-sm font-medium text-white transition-all duration-300 ease-out hover:scale-[1.02] hover:bg-[rgba(212,190,152,0.18)]"
            onClick={() => viewerRef.current?.openFilePicker()}
          >
            {isBusy ? "Streaming replacement..." : "Replace scene"}
          </button>
          <div className="mt-5 space-y-3 text-sm text-white/72">
            <div>
              <p className="text-[0.62rem] uppercase tracking-[0.28em] text-white/38">
                Active file
              </p>
              <p className="mt-2 break-all">{viewerStats.assetName}</p>
            </div>
            <div>
              <p className="text-[0.62rem] uppercase tracking-[0.28em] text-white/38">
                Diagnostics
              </p>
              <p className="mt-2">
                Press Shift+{(diagnostics?.shortcutKey ?? "D").toUpperCase()} to{" "}
                {viewerStats.diagnosticsVisible
                  ? "open the calibration inspector."
                  : "reveal the calibration inspector."}
              </p>
            </div>
          </div>
        </motion.section>

        <AnimatePresence>
          {viewerStats.diagnosticsVisible ? (
            <motion.section
              {...focusStack.getPanelProps("diagnostics")}
              tabIndex={0}
              initial={false}
              animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
              exit={
                shouldReduceMotion
                  ? { opacity: 0 }
                  : { opacity: 0, y: 14, scale: 0.96, filter: "blur(10px)" }
              }
              transition={{
                ...panelSpring,
                delay: shouldReduceMotion ? 0 : 0.72,
              }}
              style={{ zIndex: focusStack.getPanelState("diagnostics").zIndex }}
              className={getDesktopPanelClassName(
                "diagnostics",
                "absolute bottom-[calc(var(--hud-edge-padding)+19.5rem)] right-[var(--hud-edge-padding)] w-[20rem] px-5 py-5",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[0.68rem] uppercase tracking-[0.32em] text-[var(--tone-brass)]">
                    Diagnostics
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                    Hidden calibration tools for extracting live camera position, rotation, and runtime state.
                  </p>
                </div>
                <span className="glass-chip px-3 py-2 text-[0.68rem] uppercase tracking-[0.28em] text-white/44">
                  Shift+{(diagnostics?.shortcutKey ?? "D").toUpperCase()}
                </span>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <article className={desktopMetricClass}>
                  <p className="text-[0.62rem] uppercase tracking-[0.28em] text-white/38">
                    FPS
                  </p>
                  <p className="mt-3 text-[1.05rem] text-white">{formatFps(viewerStats.fps)}</p>
                </article>
                <article className={desktopMetricClass}>
                  <p className="text-[0.62rem] uppercase tracking-[0.28em] text-white/38">
                    GPU memory
                  </p>
                  <p className="mt-3 text-[1.05rem] text-white">
                    {formatGpuMemory(viewerStats.gpuMemoryBytes)}
                  </p>
                </article>
                <article className={desktopMetricClass}>
                  <p className="text-[0.62rem] uppercase tracking-[0.28em] text-white/38">
                    Backend
                  </p>
                  <p className="mt-3 text-[1.05rem] text-white">{viewerStats.backend}</p>
                </article>
                <article className={desktopMetricClass}>
                  <p className="text-[0.62rem] uppercase tracking-[0.28em] text-white/38">
                    Profile
                  </p>
                  <p className="mt-3 text-[1.05rem] text-white">
                    {viewerStats.renderQuality}
                  </p>
                </article>
              </div>
              <div className="mt-5 flex items-center gap-3">
                <button
                  type="button"
                  className="focus-ring inline-flex items-center rounded-full bg-[rgba(142,168,255,0.16)] px-5 py-3 text-sm font-medium text-white transition-all duration-300 ease-out hover:scale-[1.02] hover:bg-[rgba(142,168,255,0.22)]"
                  onClick={handleCopyCurrentView}
                >
                  Copy View Vectors
                </button>
                <AnimatePresence mode="wait">
                  {copyFeedback ? (
                    <motion.span
                      key={copyFeedback}
                      initial={shouldReduceMotion ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                      transition={detailEase}
                      className="text-[0.72rem] uppercase tracking-[0.24em] text-white/52"
                    >
                      {copyFeedback}
                    </motion.span>
                  ) : null}
                </AnimatePresence>
              </div>
            </motion.section>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="pointer-events-none absolute inset-0 z-20 lg:hidden">
        <motion.section
          initial={false}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{
            ...panelSpring,
            delay: shouldReduceMotion ? 0 : 0,
          }}
          className="absolute inset-x-[var(--hud-edge-padding-mobile)] top-[var(--hud-edge-padding-mobile)]"
        >
          <div className="hud-dock pointer-events-auto px-4 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[0.62rem] uppercase tracking-[0.32em] text-[#7f9dcb]">
                  Digital twin review
                </p>
                <h1 className="mt-2 font-[family-name:var(--font-display)] text-[2.3rem] leading-none tracking-[-0.06em] text-white">
                  AetherView
                </h1>
              </div>
              <span className="glass-chip px-3 py-2 text-[0.68rem] uppercase tracking-[0.28em] text-[var(--tone-brass)]">
                {viewerStats.backend}
              </span>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <span
                className={`h-2.5 w-2.5 rounded-full ${statusDotClassName(viewerStats.status)}`}
              />
              <p className="text-sm text-white/82">{statusLabel}</p>
            </div>
          </div>
        </motion.section>

        <motion.section
          initial={false}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{
            ...panelSpring,
            delay: shouldReduceMotion ? 0 : 0.2,
          }}
          className="absolute inset-x-[var(--hud-edge-padding-mobile)] bottom-[var(--hud-edge-padding-mobile)]"
        >
          <div className="hud-dock pointer-events-auto max-h-[52svh] overflow-auto px-4 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[0.62rem] uppercase tracking-[0.3em] text-white/40">
                  Viewpoints
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                  Docked rail for room jumps and scene replacement.
                </p>
              </div>
              <span className="glass-chip px-3 py-2 text-[0.68rem] uppercase tracking-[0.28em] text-white/48">
                {viewerStats.renderQuality}
              </span>
            </div>
            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              {roomPresets.map((preset) => {
                const isActive = activePresetId === preset.id;

                return (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={!canNavigate}
                    className={`focus-ring shrink-0 rounded-full px-4 py-3 text-sm font-medium transition-colors duration-200 ${
                      isActive
                        ? "bg-white/[0.13] text-white shadow-[0_16px_32px_rgba(0,0,0,0.18)]"
                        : "bg-white/[0.05] text-white/78 hover:bg-white/[0.08]"
                    } disabled:opacity-45`}
                    onClick={() => {
                      viewerRef.current?.focusPreset(preset.id);
                      setActivePresetId(preset.id);
                    }}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-5 grid gap-4 text-sm text-white/74">
              <div>
                <p className="text-[0.62rem] uppercase tracking-[0.28em] text-white/38">
                  Active file
                </p>
                <p className="mt-2 break-all">{viewerStats.assetName}</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className="focus-ring rounded-full bg-[rgba(212,190,152,0.12)] px-5 py-3 text-sm font-medium text-white transition-colors duration-200 hover:bg-[rgba(212,190,152,0.18)]"
                  onClick={() => viewerRef.current?.openFilePicker()}
                >
                  {isBusy ? "Streaming replacement..." : "Replace scene"}
                </button>
                {viewerStats.diagnosticsVisible ? (
                  <button
                    type="button"
                    className="focus-ring rounded-full bg-[rgba(142,168,255,0.16)] px-5 py-3 text-sm font-medium text-white transition-colors duration-200 hover:bg-[rgba(142,168,255,0.22)]"
                    onClick={handleCopyCurrentView}
                  >
                    Copy View Vectors
                  </button>
                ) : (
                  <div className="glass-chip px-4 py-3 text-[0.72rem] uppercase tracking-[0.24em] text-white/48">
                    Shift+{(diagnostics?.shortcutKey ?? "D").toUpperCase()} diagnostics
                  </div>
                )}
              </div>
            </div>

            {viewerStats.diagnosticsVisible ? (
              <div className="mt-5 grid grid-cols-2 gap-3 text-sm text-white/74">
                <article className={desktopMetricClass}>
                  <p className="text-[0.62rem] uppercase tracking-[0.28em] text-white/38">
                    FPS
                  </p>
                  <p className="mt-3 text-white">{formatFps(viewerStats.fps)}</p>
                </article>
                <article className={desktopMetricClass}>
                  <p className="text-[0.62rem] uppercase tracking-[0.28em] text-white/38">
                    GPU memory
                  </p>
                  <p className="mt-3 text-white">
                    {formatGpuMemory(viewerStats.gpuMemoryBytes)}
                  </p>
                </article>
              </div>
            ) : null}
          </div>
        </motion.section>
      </div>
    </main>
  );
}
