"use client";

import Image from "next/image";
import Link from "next/link";
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

type HudPanelId = "identity" | "telemetry" | "dock" | "diagnostics";

const DESKTOP_PANEL_IDS = [
  "identity",
  "telemetry",
  "dock",
  "diagnostics",
] as const satisfies readonly HudPanelId[];

const desktopMetricClass =
  "rounded-[1.15rem] border border-white/8 bg-white/[0.04] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]";

interface DigitalTwinDashboardProps {
  assetUrl?: string;
  assetName?: string;
  roomPresets: ViewPreset[];
  initialPresetId?: string;
  diagnostics?: DiagnosticsConfig;
  derivePresetGeometry?: boolean;
}

interface EyeIconProps {
  crossed?: boolean;
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

function EyeIcon({ crossed = false }: EyeIconProps): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M2.2 12c1.9-3.5 5.3-5.6 9.8-5.6 4.5 0 7.9 2.1 9.8 5.6-1.9 3.5-5.3 5.6-9.8 5.6-4.5 0-7.9-2.1-9.8-5.6Z" />
      <circle cx="12" cy="12" r="3" />
      {crossed ? <path d="M4 20 20 4" /> : null}
    </svg>
  );
}

export function DigitalTwinDashboard({
  assetUrl,
  assetName,
  roomPresets,
  initialPresetId,
  diagnostics,
  derivePresetGeometry = false,
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
  const [isZenMode, setIsZenMode] = useState(false);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
        return;

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return;
      }

      if (event.key.toLowerCase() !== "z")
        return;

      event.preventDefault();
      setIsZenMode((current) => !current);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const panelSpring = shouldReduceMotion
    ? { duration: 0.01 }
    : { type: "spring" as const, stiffness: 86, damping: 18, mass: 0.94 };
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
      roomPresets.find((preset) => preset.id === hoveredPresetId) ??
      activePreset ??
      null,
    [activePreset, hoveredPresetId, roomPresets],
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

  const getDesktopPanelClassName = (
    panelId: HudPanelId,
    extraClassName: string,
  ) => {
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

  const hiddenHudClassName = isZenMode
    ? "pointer-events-none opacity-0"
    : "opacity-100";

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
      rotateX: -normalizedY * 8,
      rotateY: normalizedX * 12,
    });
  };

  const renderPreviewCard = () => {
    if (!previewPreset)
      return null;

    const shouldRenderFallback =
      previewFailures[previewPreset.id] || !previewPreset.previewImageSrc;

    return (
      <AnimatePresence>
        {!isZenMode ? (
          <motion.aside
            aria-hidden="true"
            key={previewPreset.id}
            initial={
              shouldReduceMotion
                ? false
                : { opacity: 0, x: "-50%", y: 18, scale: 0.96, filter: "blur(10px)" }
            }
            animate={{
              opacity: 1,
              x: "-50%",
              y: 0,
              scale: 1,
              filter: "blur(0px)",
              rotateX: shouldReduceMotion ? 0 : previewTilt.rotateX,
              rotateY: shouldReduceMotion ? 0 : previewTilt.rotateY,
            }}
            exit={
              shouldReduceMotion
                ? { opacity: 0 }
                : {
                    opacity: 0,
                    x: "-50%",
                    y: 12,
                    scale: 0.97,
                    filter: "blur(10px)",
                  }
            }
            transition={panelSpring}
            className="pointer-events-none absolute bottom-[calc(var(--hud-edge-padding)+13.5rem)] left-1/2 hidden w-[18rem] lg:block"
            style={{ transformPerspective: 1200 }}
          >
            <div className="hud-preview-card overflow-hidden p-3">
              {shouldRenderFallback ? (
                <div className="rounded-[1.25rem] bg-[linear-gradient(180deg,rgba(18,19,23,0.94),rgba(9,10,13,0.94))] p-5">
                  <div className="h-32 rounded-[1rem] bg-[radial-gradient(circle_at_top,rgba(142,168,255,0.24),transparent_46%),linear-gradient(180deg,rgba(33,41,54,0.92),rgba(13,14,17,0.92))]" />
                  <p className="mt-4 text-[0.66rem] uppercase tracking-[0.32em] text-[var(--tone-brass)]">
                    Simulation card
                  </p>
                  <p className="mt-2 text-2xl tracking-[-0.04em] text-white">
                    {previewPreset.label}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-white/62">
                    {previewPreset.previewCaption ?? previewPreset.description}
                  </p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-[1.25rem]">
                  <Image
                    src={previewPreset.previewImageSrc}
                    alt={previewPreset.previewAlt ?? `${previewPreset.label} preview`}
                    width={288}
                    height={180}
                    unoptimized
                    className="h-40 w-full object-cover"
                    onError={() =>
                      setPreviewFailures((currentFailures) => ({
                        ...currentFailures,
                        [previewPreset.id]: true,
                      }))
                    }
                  />
                  <div className="bg-[linear-gradient(180deg,rgba(17,18,22,0.94),rgba(7,8,10,0.96))] px-4 py-4">
                    <p className="text-[0.66rem] uppercase tracking-[0.32em] text-[var(--tone-brass)]">
                      Simulation card
                    </p>
                    <p className="mt-2 text-2xl tracking-[-0.04em] text-white">
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
        ) : null}
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
          derivePresetGeometry={derivePresetGeometry}
          onStatsChange={setViewerStats}
          onStateChange={setLoadState}
          onViewpointMotionChange={setIsViewpointTransitioning}
          onViewportInteract={focusStack.resetFocus}
        />
      </div>

      <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(180deg,rgba(4,5,8,0.18),rgba(4,5,8,0.02)_34%,rgba(4,5,8,0.22))]" />

      <div className="pointer-events-none absolute right-6 top-6 z-30">
        <motion.button
          type="button"
          initial={shouldReduceMotion ? false : { opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={detailEase}
          aria-label={
            isZenMode ? "Exit full screen mode" : "Enter full screen mode"
          }
          aria-pressed={isZenMode}
          className="glass-chip pointer-events-auto inline-flex items-center gap-3 px-4 py-3 font-[family-name:var(--font-mono)] text-[0.72rem] uppercase tracking-[0.24em] text-white/76 transition-all duration-300 ease-out hover:scale-[1.03] hover:border-white/20"
          onClick={() => setIsZenMode((current) => !current)}
        >
          <EyeIcon crossed={isZenMode} />
          {isZenMode ? "Exit Full Screen" : "Full Screen"}
        </motion.button>
      </div>

      <div className="pointer-events-none absolute inset-0 z-20 hidden lg:block">
        <motion.section
          {...focusStack.getPanelProps("identity")}
          tabIndex={0}
          initial={false}
          animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
          transition={panelSpring}
          style={{ zIndex: focusStack.getPanelState("identity").zIndex }}
          className={`${getDesktopPanelClassName(
            "identity",
            "absolute left-[var(--hud-edge-padding)] top-[var(--hud-edge-padding)] w-[18rem] px-5 py-5",
          )} transition-all duration-300 ease-out ${hiddenHudClassName}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[0.64rem] uppercase tracking-[0.38em] text-[#8ea8ff]">
                AETHERVIEW / HUD
              </p>
              <h1 className="mt-3 text-[2rem] leading-none tracking-[-0.06em] text-white">
                Spatial Sim
              </h1>
            </div>
            <Link
              href="/"
              className="focus-ring rounded-full border border-white/8 bg-white/[0.05] px-3 py-2 font-[family-name:var(--font-mono)] text-[0.64rem] uppercase tracking-[0.2em] text-white/52 transition-colors duration-300 hover:border-white/16 hover:bg-white/[0.08]"
            >
              Home
            </Link>
          </div>
          <p className="mt-4 text-sm leading-7 text-[var(--text-secondary)]">
            Walk-through tooling for architectural review, spatial calibration,
            and presentation-grade digital twin capture.
          </p>
          <div className="mt-5 flex items-center gap-3">
            <span
              className={`h-2.5 w-2.5 rounded-full ${statusDotClassName(viewerStats.status)}`}
            />
            <p className="font-[family-name:var(--font-mono)] text-[0.76rem] uppercase tracking-[0.24em] text-white/72">
              {statusLabel}
            </p>
          </div>
          <div className="mt-5 space-y-4 text-sm text-white/74">
            <div>
              <p className="text-[0.62rem] uppercase tracking-[0.3em] text-white/34">
                Active room
              </p>
              <p className="mt-2 text-base text-white">
                {activePreset?.label ?? "Standby"}
              </p>
            </div>
            <div>
              <p className="text-[0.62rem] uppercase tracking-[0.3em] text-white/34">
                Active file
              </p>
              <p className="mt-2 break-all text-[0.94rem] text-white/62">
                {viewerStats.assetName}
              </p>
            </div>
          </div>
        </motion.section>

        <motion.section
          {...focusStack.getPanelProps("telemetry")}
          tabIndex={0}
          initial={false}
          animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
          transition={{
            ...panelSpring,
            delay: shouldReduceMotion ? 0 : 0.08,
          }}
          style={{ zIndex: focusStack.getPanelState("telemetry").zIndex }}
          className={`${getDesktopPanelClassName(
            "telemetry",
            "absolute right-[var(--hud-edge-padding)] top-[var(--hud-edge-padding)] w-[19rem] px-5 py-5",
          )} transition-all duration-300 ease-out ${hiddenHudClassName}`}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[0.64rem] uppercase tracking-[0.34em] text-white/38">
                Runtime telemetry
              </p>
              <p className="mt-2 text-sm leading-6 text-white/58">
                Live rendering, walk-state, and capture status.
              </p>
            </div>
            <div className="glass-chip animate-badge-pulse px-3 py-2 font-[family-name:var(--font-mono)] text-[0.68rem] uppercase tracking-[0.24em] text-[#d4be98]">
              Live: {formatFps(viewerStats.fps)}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <article className={desktopMetricClass}>
              <p className="text-[0.62rem] uppercase tracking-[0.28em] text-white/34">
                Backend
              </p>
              <p className="mt-3 font-[family-name:var(--font-mono)] text-[1rem] uppercase tracking-[0.12em] text-white">
                {viewerStats.backend}
              </p>
            </article>
            <article className={desktopMetricClass}>
              <p className="text-[0.62rem] uppercase tracking-[0.28em] text-white/34">
                Splat Count
              </p>
              <p className="metric-gradient mt-3 font-[family-name:var(--font-mono)] text-[1.1rem] uppercase tracking-[0.08em]">
                {formatSplatCount(viewerStats.splatCount)}
              </p>
            </article>
            <article className={desktopMetricClass}>
              <p className="text-[0.62rem] uppercase tracking-[0.28em] text-white/34">
                View status
              </p>
              <p className="metric-gradient mt-3 font-[family-name:var(--font-mono)] text-[1.05rem] uppercase tracking-[0.1em]">
                {displayStatus}
              </p>
            </article>
            <article className={desktopMetricClass}>
              <p className="text-[0.62rem] uppercase tracking-[0.28em] text-white/34">
                Motion
              </p>
              <p className="mt-3 font-[family-name:var(--font-mono)] text-[1rem] uppercase tracking-[0.12em] text-white">
                {isViewpointTransitioning ? "Moving" : "Settled"}
              </p>
            </article>
          </div>
        </motion.section>

        {renderPreviewCard()}

        <motion.section
          {...focusStack.getPanelProps("dock")}
          tabIndex={0}
          initial={false}
          animate={{ opacity: 1, x: "-50%", y: 0, scale: 1 }}
          transition={{
            ...panelSpring,
            delay: shouldReduceMotion ? 0 : 0.16,
          }}
          style={{ zIndex: focusStack.getPanelState("dock").zIndex }}
          className={`${getDesktopPanelClassName(
            "dock",
            "absolute bottom-[var(--hud-edge-padding)] left-1/2 w-[min(calc(100%-3rem),62rem)] px-5 py-5",
          )} transition-all duration-300 ease-out ${hiddenHudClassName}`}
        >
          <div className="flex items-start justify-between gap-6">
            <div className="max-w-[21rem]">
              <p className="text-[0.64rem] uppercase tracking-[0.34em] text-[var(--tone-brass)]">
                Simulation Dock
              </p>
              <p className="mt-3 text-sm leading-7 text-white/62">
                Curated room jumps, manual walk-through, scene replacement, and
                hidden calibration tools in one floating control rail.
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <span className="glass-chip px-4 py-3 font-[family-name:var(--font-mono)] text-[0.68rem] uppercase tracking-[0.24em] text-white/56">
                WASD / Arrows
              </span>
              <span className="glass-chip px-4 py-3 font-[family-name:var(--font-mono)] text-[0.68rem] uppercase tracking-[0.24em] text-white/56">
                Drag / Wheel
              </span>
              <span className="glass-chip px-4 py-3 font-[family-name:var(--font-mono)] text-[0.68rem] uppercase tracking-[0.24em] text-white/56">
                Z = Zen
              </span>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            {roomPresets.map((preset) => {
              const isActive = activePresetId === preset.id;

              return (
                <motion.button
                  key={preset.id}
                  type="button"
                  disabled={!canNavigate}
                  className={`focus-ring rounded-full border px-4 py-3 text-left text-sm font-medium transition-all duration-300 ease-out ${
                    isActive
                      ? "border-white/20 bg-white/[0.12] text-white shadow-[0_20px_48px_rgba(0,0,0,0.22)]"
                      : "border-white/8 bg-white/[0.05] text-white/78 hover:border-white/18 hover:bg-white/[0.08]"
                  } disabled:cursor-not-allowed disabled:opacity-45`}
                  whileHover={
                    shouldReduceMotion
                      ? undefined
                      : { scale: 1.045, y: -1 }
                  }
                  whileTap={
                    shouldReduceMotion
                      ? undefined
                      : { scale: 0.985 }
                  }
                  transition={
                    shouldReduceMotion
                      ? { duration: 0.01 }
                      : { type: "spring", stiffness: 100, damping: 16 }
                  }
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
                  <span className="font-[family-name:var(--font-mono)] uppercase tracking-[0.18em]">
                    {preset.label}
                  </span>
                </motion.button>
              );
            })}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="focus-ring rounded-full border border-white/10 bg-[rgba(212,190,152,0.14)] px-5 py-3 text-sm font-medium text-white transition-all duration-300 ease-out hover:scale-[1.02] hover:border-white/16 hover:bg-[rgba(212,190,152,0.2)]"
              onClick={() => viewerRef.current?.openFilePicker()}
            >
              {isBusy ? "Streaming replacement..." : "Replace scene"}
            </button>

            {viewerStats.diagnosticsVisible ? (
              <button
                type="button"
                className="focus-ring rounded-full border border-white/10 bg-[rgba(142,168,255,0.16)] px-5 py-3 text-sm font-medium text-white transition-all duration-300 ease-out hover:scale-[1.02] hover:border-white/16 hover:bg-[rgba(142,168,255,0.22)]"
                onClick={handleCopyCurrentView}
              >
                Copy View Vectors
              </button>
            ) : (
              <div className="glass-chip px-4 py-3 font-[family-name:var(--font-mono)] text-[0.72rem] uppercase tracking-[0.22em] text-white/50">
                Shift+{(diagnostics?.shortcutKey ?? "D").toUpperCase()} Diagnostics
              </div>
            )}

            <div className="font-[family-name:var(--font-mono)] text-[0.72rem] uppercase tracking-[0.22em] text-white/42">
              Walk speed / 2.2 MPS
            </div>

            <AnimatePresence mode="wait">
              {copyFeedback ? (
                <motion.span
                  key={copyFeedback}
                  initial={shouldReduceMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                  transition={detailEase}
                  className="text-[0.72rem] uppercase tracking-[0.24em] text-white/50"
                >
                  {copyFeedback}
                </motion.span>
              ) : null}
            </AnimatePresence>
          </div>
        </motion.section>

        <AnimatePresence>
          {viewerStats.diagnosticsVisible && !isZenMode ? (
            <motion.section
              {...focusStack.getPanelProps("diagnostics")}
              tabIndex={0}
              initial={shouldReduceMotion ? false : { opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={
                shouldReduceMotion
                  ? { opacity: 0 }
                  : { opacity: 0, y: 16, scale: 0.98, filter: "blur(10px)" }
              }
              transition={panelSpring}
              style={{ zIndex: focusStack.getPanelState("diagnostics").zIndex }}
              className={getDesktopPanelClassName(
                "diagnostics",
                "absolute bottom-[calc(var(--hud-edge-padding)+12rem)] right-[var(--hud-edge-padding)] w-[20rem] px-5 py-5",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[0.64rem] uppercase tracking-[0.34em] text-[var(--tone-brass)]">
                    Diagnostics
                  </p>
                  <p className="mt-2 text-sm leading-6 text-white/58">
                    Hidden calibration data for exact view vectors and runtime
                    stability checks.
                  </p>
                </div>
                <span className="glass-chip px-3 py-2 font-[family-name:var(--font-mono)] text-[0.64rem] uppercase tracking-[0.2em] text-white/48">
                  Shift+{(diagnostics?.shortcutKey ?? "D").toUpperCase()}
                </span>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <article className={desktopMetricClass}>
                  <p className="text-[0.62rem] uppercase tracking-[0.28em] text-white/34">
                    FPS
                  </p>
                  <p className="mt-3 font-[family-name:var(--font-mono)] text-white">
                    {formatFps(viewerStats.fps)}
                  </p>
                </article>
                <article className={desktopMetricClass}>
                  <p className="text-[0.62rem] uppercase tracking-[0.28em] text-white/34">
                    GPU memory
                  </p>
                  <p className="mt-3 font-[family-name:var(--font-mono)] text-white">
                    {formatGpuMemory(viewerStats.gpuMemoryBytes)}
                  </p>
                </article>
                <article className={desktopMetricClass}>
                  <p className="text-[0.62rem] uppercase tracking-[0.28em] text-white/34">
                    Profile
                  </p>
                  <p className="mt-3 font-[family-name:var(--font-mono)] text-white">
                    {viewerStats.renderQuality}
                  </p>
                </article>
                <article className={desktopMetricClass}>
                  <p className="text-[0.62rem] uppercase tracking-[0.28em] text-white/34">
                    State
                  </p>
                  <p className="mt-3 font-[family-name:var(--font-mono)] text-white">
                    {viewerStats.status}
                  </p>
                </article>
              </div>
            </motion.section>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="pointer-events-none absolute inset-0 z-20 lg:hidden">
        <motion.section
          initial={false}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={panelSpring}
          className={`absolute inset-x-[var(--hud-edge-padding-mobile)] top-[var(--hud-edge-padding-mobile)] transition-all duration-300 ease-out ${hiddenHudClassName}`}
        >
          <div className="hud-dock pointer-events-auto px-4 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[0.62rem] uppercase tracking-[0.32em] text-[#8ea8ff]">
                  AETHERVIEW / HUD
                </p>
                <h1 className="mt-2 text-[2rem] leading-none tracking-[-0.06em] text-white">
                  Spatial Sim
                </h1>
              </div>
              <span className="glass-chip px-3 py-2 font-[family-name:var(--font-mono)] text-[0.66rem] uppercase tracking-[0.22em] text-[var(--tone-brass)]">
                {displayStatus}
              </span>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <span
                className={`h-2.5 w-2.5 rounded-full ${statusDotClassName(viewerStats.status)}`}
              />
              <p className="font-[family-name:var(--font-mono)] text-[0.72rem] uppercase tracking-[0.22em] text-white/70">
                {statusLabel}
              </p>
            </div>
          </div>
        </motion.section>

        <motion.section
          initial={false}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{
            ...panelSpring,
            delay: shouldReduceMotion ? 0 : 0.08,
          }}
          className={`absolute inset-x-[var(--hud-edge-padding-mobile)] bottom-[var(--hud-edge-padding-mobile)] transition-all duration-300 ease-out ${hiddenHudClassName}`}
        >
          <div className="hud-dock pointer-events-auto max-h-[52svh] overflow-auto px-4 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[0.62rem] uppercase tracking-[0.3em] text-white/40">
                  Simulation Dock
                </p>
                <p className="mt-2 text-sm leading-6 text-white/62">
                  Walk, jump, replace, and calibrate from one mobile rail.
                </p>
              </div>
              <span className="glass-chip px-3 py-2 font-[family-name:var(--font-mono)] text-[0.66rem] uppercase tracking-[0.22em] text-white/48">
                {formatFps(viewerStats.fps)}
              </span>
            </div>

            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              {roomPresets.map((preset) => {
                const isActive = activePresetId === preset.id;

                return (
                  <motion.button
                    key={preset.id}
                    type="button"
                    disabled={!canNavigate}
                    className={`focus-ring shrink-0 rounded-full border px-4 py-3 text-sm font-medium transition-all duration-300 ease-out ${
                      isActive
                        ? "border-white/20 bg-white/[0.13] text-white shadow-[0_16px_32px_rgba(0,0,0,0.2)]"
                        : "border-white/8 bg-white/[0.05] text-white/78 hover:bg-white/[0.08]"
                    } disabled:opacity-45`}
                    whileHover={
                      shouldReduceMotion
                        ? undefined
                        : { scale: 1.03 }
                    }
                    whileTap={
                      shouldReduceMotion
                        ? undefined
                        : { scale: 0.985 }
                    }
                    transition={
                      shouldReduceMotion
                        ? { duration: 0.01 }
                        : { type: "spring", stiffness: 100, damping: 16 }
                    }
                    onClick={() => {
                      viewerRef.current?.focusPreset(preset.id);
                      setActivePresetId(preset.id);
                    }}
                  >
                    {preset.label}
                  </motion.button>
                );
              })}
            </div>

            <div className="mt-5 grid gap-4 text-sm text-white/72">
              <div>
                <p className="text-[0.62rem] uppercase tracking-[0.28em] text-white/34">
                  Active room
                </p>
                <p className="mt-2 text-white">{activePreset?.label ?? "Standby"}</p>
              </div>
              <div>
                <p className="text-[0.62rem] uppercase tracking-[0.28em] text-white/34">
                  Active file
                </p>
                <p className="mt-2 break-all">{viewerStats.assetName}</p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                className="focus-ring rounded-full border border-white/10 bg-[rgba(212,190,152,0.14)] px-5 py-3 text-sm font-medium text-white transition-all duration-300 ease-out hover:bg-[rgba(212,190,152,0.2)]"
                onClick={() => viewerRef.current?.openFilePicker()}
              >
                {isBusy ? "Streaming replacement..." : "Replace scene"}
              </button>
              {viewerStats.diagnosticsVisible ? (
                <button
                  type="button"
                  className="focus-ring rounded-full border border-white/10 bg-[rgba(142,168,255,0.16)] px-5 py-3 text-sm font-medium text-white transition-all duration-300 ease-out hover:bg-[rgba(142,168,255,0.22)]"
                  onClick={handleCopyCurrentView}
                >
                  Copy View Vectors
                </button>
              ) : (
                <div className="glass-chip px-4 py-3 font-[family-name:var(--font-mono)] text-[0.68rem] uppercase tracking-[0.2em] text-white/48">
                  Shift+{(diagnostics?.shortcutKey ?? "D").toUpperCase()} Diagnostics
                </div>
              )}
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <span className="glass-chip px-4 py-3 font-[family-name:var(--font-mono)] text-[0.66rem] uppercase tracking-[0.2em] text-white/50">
                WASD / Arrows
              </span>
              <span className="glass-chip px-4 py-3 font-[family-name:var(--font-mono)] text-[0.66rem] uppercase tracking-[0.2em] text-white/50">
                Z = Zen
              </span>
            </div>
          </div>
        </motion.section>
      </div>
    </main>
  );
}
