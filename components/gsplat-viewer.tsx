"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import type * as PlayCanvas from "playcanvas";

import type {
  DiagnosticsConfig,
  RenderQualityMode,
  Vector3Tuple,
  ViewPreset,
  ViewerLoadState,
  ViewerStats,
} from "@/types/spatial";

type PlayCanvasModule = typeof import("playcanvas");

interface CameraTransition {
  elapsedMs: number;
  durationMs: number;
  targetDurationMs: number;
  fromPosition: PlayCanvas.Vec3;
  toPosition: PlayCanvas.Vec3;
  fromTarget: PlayCanvas.Vec3;
  toTarget: PlayCanvas.Vec3;
  positionScratch: PlayCanvas.Vec3;
  targetScratch: PlayCanvas.Vec3;
}

interface HeroOrbitState {
  elapsedMs: number;
  durationMs: number;
  centerTarget: PlayCanvas.Vec3;
  startYaw: number;
  endYaw: number;
  startPitch: number;
  endPitch: number;
  distance: number;
}

interface ViewerErrorState {
  eyebrow: string;
  title: string;
  detail: string;
}

interface ViewerCameraSnapshot {
  position: Vector3Tuple;
  target: Vector3Tuple;
  rotationEuler: Vector3Tuple;
}

export interface GsplatViewerHandle {
  focusPreset: (id: string) => void;
  openFilePicker: () => void;
  copyCurrentView: () => ViewerCameraSnapshot;
}

interface GsplatViewerProps {
  assetUrl?: string;
  assetName?: string;
  presets: ViewPreset[];
  initialPresetId?: string;
  diagnostics?: DiagnosticsConfig;
  derivePresetGeometry?: boolean;
  onStatsChange: (stats: ViewerStats) => void;
  onStateChange: (state: ViewerLoadState) => void;
  onViewpointMotionChange?: (isMoving: boolean) => void;
  onViewportInteract?: () => void;
}

const initialViewerStats: ViewerStats = {
  backend: "Initializing",
  assetName: "Awaiting capture",
  splatCount: null,
  fps: null,
  gpuMemoryBytes: null,
  renderQuality: "Balanced",
  diagnosticsVisible: false,
  fallbackMode: false,
  status: "idle",
};

const statusByState: Record<ViewerLoadState, ViewerStats["status"]> = {
  idle: "idle",
  loading: "loading",
  framing: "framing",
  ready: "ready",
  error: "error",
};

const floatingChipClass =
  "rounded-full border border-white/10 bg-black/20 backdrop-blur-3xl shadow-[0_18px_60px_rgba(0,0,0,0.28)]";

const VIEWER_HARDENING = {
  alphaThreshold: 0.1,
  splatScale: 1,
  cameraFov: 62,
  lodUpdateAngle: 0.08,
  lodUpdateDistance: 0.002,
  walkingSpeed: 1.5,
  walkingBoost: 1,
  lookDistance: 3.6,
  sceneBoundsPadding: 1.1,
} as const;

const gsplatHardeningGlsl = /* glsl */ `
void modifySplatCenter(inout vec3 center) {}

void modifySplatRotationScale(vec3 originalCenter, vec3 modifiedCenter, inout vec4 rotation, inout vec3 scale) {
    scale *= ${VIEWER_HARDENING.splatScale.toFixed(2)};
}

void modifySplatColor(vec3 center, inout vec4 color) {
    if (color.a < ${VIEWER_HARDENING.alphaThreshold.toFixed(2)}) {
        color.a = 0.0;
    }
}
`;

const gsplatHardeningWgsl = /* wgsl */ `
fn modifySplatCenter(center: ptr<function, vec3f>) {}

fn modifySplatRotationScale(originalCenter: vec3f, modifiedCenter: vec3f, rotation: ptr<function, vec4f>, scale: ptr<function, vec3f>) {
    *scale *= vec3f(
        ${VIEWER_HARDENING.splatScale.toFixed(2)},
        ${VIEWER_HARDENING.splatScale.toFixed(2)},
        ${VIEWER_HARDENING.splatScale.toFixed(2)}
    );
}

fn modifySplatColor(center: vec3f, color: ptr<function, vec4f>) {
    if ((*color).a < ${VIEWER_HARDENING.alphaThreshold.toFixed(2)}) {
        (*color).a = 0.0;
    }
}
`;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function distanceBetween(a: readonly number[], b: readonly number[]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];

  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function copyVector(source: readonly number[]): [number, number, number] {
  return [source[0], source[1], source[2]];
}

function sphericalToCartesian(
  yaw: number,
  pitch: number,
  distance: number,
  target: readonly number[],
): [number, number, number] {
  const cosPitch = Math.cos(pitch);
  const x = target[0] + distance * Math.sin(yaw) * cosPitch;
  const y = target[1] + distance * Math.sin(pitch);
  const z = target[2] + distance * Math.cos(yaw) * cosPitch;

  return [x, y, z];
}

function directionFromYawPitch(
  yaw: number,
  pitch: number,
): [number, number, number] {
  const cosPitch = Math.cos(pitch);

  return [
    Math.sin(yaw) * cosPitch,
    Math.sin(pitch),
    Math.cos(yaw) * cosPitch,
  ];
}

function deriveLookFromPose(
  position: readonly number[],
  target: readonly number[],
): { yaw: number; pitch: number; distance: number } {
  const offsetX = target[0] - position[0];
  const offsetY = target[1] - position[1];
  const offsetZ = target[2] - position[2];
  const planarDistance = Math.sqrt(offsetX * offsetX + offsetZ * offsetZ);
  const distance = Math.sqrt(
    offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ,
  );

  return {
    yaw: Math.atan2(offsetX, offsetZ),
    pitch: Math.atan2(offsetY, Math.max(planarDistance, 0.0001)),
    distance: Math.max(distance, 0.5),
  };
}

function mergePresetsWithDerivedGeometry(
  providedPresets: ViewPreset[],
  derivedPresets: ViewPreset[],
): ViewPreset[] {
  const presetsById = buildPresetMap(providedPresets);

  return derivedPresets.map((derivedPreset, index) => {
    const providedPreset =
      presetsById[derivedPreset.id] ?? providedPresets[index] ?? null;

    if (!providedPreset)
      return derivedPreset;

    return {
      ...derivedPreset,
      label: providedPreset.label,
      description: providedPreset.description,
      previewImageSrc:
        providedPreset.previewImageSrc || derivedPreset.previewImageSrc,
      previewAlt: providedPreset.previewAlt ?? derivedPreset.previewAlt,
      previewCaption:
        providedPreset.previewCaption ?? derivedPreset.previewCaption,
      durationMs: providedPreset.durationMs ?? derivedPreset.durationMs,
    };
  });
}

function easeOutQuart(value: number): number {
  return 1 - Math.pow(1 - value, 4);
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}

function easeInOutSine(value: number): number {
  return -(Math.cos(Math.PI * value) - 1) / 2;
}

function buildFallbackPresets(
  center: readonly number[],
  halfExtents: readonly number[],
): ViewPreset[] {
  const radius = Math.max(
    Math.sqrt(
      halfExtents[0] * halfExtents[0] +
        halfExtents[1] * halfExtents[1] +
        halfExtents[2] * halfExtents[2],
    ),
    1.2,
  );

  const elevatedTarget: [number, number, number] = [
    center[0],
    center[1] + halfExtents[1] * 0.18,
    center[2],
  ];

  return [
    {
      id: "entryway",
      label: "Entryway",
      description: "Derived fallback framing for immediate orientation.",
      position: [center[0], center[1] + radius * 0.18, center[2] + radius * 2.25],
      previewImageSrc: "/assets/viewpoints/fallback-preview.svg",
      previewAlt: "Derived entryway fallback preview",
      previewCaption: "Fallback framing generated from the active spatial bounds.",
      target: elevatedTarget,
      durationMs: 1200,
    },
    {
      id: "kitchen",
      label: "Kitchen",
      description: "Derived oblique study for adjacency and depth review.",
      position: [
        center[0] + radius * 1.45,
        center[1] + radius * 0.62,
        center[2] + radius * 1.45,
      ],
      previewImageSrc: "/assets/viewpoints/fallback-preview.svg",
      previewAlt: "Derived kitchen fallback preview",
      previewCaption: "Fallback oblique camera study generated from the active scene.",
      target: elevatedTarget,
      durationMs: 1280,
    },
    {
      id: "lounge",
      label: "Lounge",
      description: "Derived closer study for focal detail and contour checks.",
      position: [center[0], center[1] + radius * 0.34, center[2] + radius * 1.08],
      previewImageSrc: "/assets/viewpoints/fallback-preview.svg",
      previewAlt: "Derived lounge fallback preview",
      previewCaption: "Fallback focal study generated when no explicit room presets exist.",
      target: [center[0], center[1] + halfExtents[1] * 0.28, center[2]],
      durationMs: 1360,
    },
  ];
}

function buildPresetMap(presets: ViewPreset[]): Record<string, ViewPreset> {
  return presets.reduce<Record<string, ViewPreset>>((accumulator, preset) => {
    accumulator[preset.id] = preset;
    return accumulator;
  }, {});
}

function resolveTargetFromPreset(
  pc: PlayCanvasModule,
  preset: ViewPreset,
): Vector3Tuple {
  if (preset.target)
    return copyVector(preset.target);

  if (preset.rotationEuler) {
    const forward = new pc.Quat()
      .setFromEulerAngles(
        preset.rotationEuler[0],
        preset.rotationEuler[1],
        preset.rotationEuler[2],
      )
      .transformVector(new pc.Vec3(0, 0, -1));
    const focusDistance = preset.focusDistance ?? 6;

    return [
      preset.position[0] + forward.x * focusDistance,
      preset.position[1] + forward.y * focusDistance,
      preset.position[2] + forward.z * focusDistance,
    ];
  }

  return [preset.position[0], preset.position[1], preset.position[2] - 6];
}

function getGpuMemoryBytes(
  app: PlayCanvas.AppBase,
  graphicsDevice: PlayCanvas.GraphicsDevice,
): number | null {
  const candidate =
    (graphicsDevice as {
      memory?: Record<string, number>;
      _vram?: Record<string, number>;
    }).memory ??
    ((app.stats as { vram?: Record<string, number> }).vram ??
      (graphicsDevice as { _vram?: Record<string, number> })._vram);

  if (!candidate)
    return null;

  if (typeof candidate.total === "number")
    return candidate.total;

  const textureBytes =
    typeof candidate.tex === "number"
      ? candidate.tex
      : (candidate.texShadow ?? 0) +
        (candidate.texAsset ?? 0) +
        (candidate.texLightmap ?? 0);

  const bufferBytes =
    (candidate.vb ?? 0) +
    (candidate.ib ?? 0) +
    (candidate.ub ?? 0) +
    (candidate.sb ?? 0);

  const totalBytes = textureBytes + bufferBytes;

  return totalBytes > 0 ? totalBytes : null;
}

function applyRenderProfile(
  pc: PlayCanvasModule,
  app: PlayCanvas.AppBase,
  graphicsDevice: PlayCanvas.GraphicsDevice,
): {
  backend: string;
  renderQuality: RenderQualityMode;
  fallbackMode: boolean;
} {
  const isWebGPU =
    graphicsDevice.deviceType === pc.DEVICETYPE_WEBGPU || graphicsDevice.isWebGPU;

  app.scene.gsplat.renderer = pc.GSPLAT_RENDERER_AUTO;
  app.scene.gsplat.lodUpdateDistance = VIEWER_HARDENING.lodUpdateDistance;
  app.scene.gsplat.lodUpdateAngle = VIEWER_HARDENING.lodUpdateAngle;
  app.scene.gsplat.lodBehindPenalty = 3;
  app.scene.gsplat.radialSorting = false;
  app.scene.gsplat.antiAlias = true;

  if (isWebGPU) {
    app.scene.gsplat.alphaClip = VIEWER_HARDENING.alphaThreshold;
    app.scene.gsplat.alphaClipForward = VIEWER_HARDENING.alphaThreshold;
    app.scene.gsplat.minPixelSize = 1.25;
    app.scene.gsplat.minContribution = 0.32;

    return {
      backend: "WebGPU",
      renderQuality: "Cinematic",
      fallbackMode: false,
    };
  }

  graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 1.35);
  app.scene.gsplat.alphaClip = VIEWER_HARDENING.alphaThreshold;
  app.scene.gsplat.alphaClipForward = VIEWER_HARDENING.alphaThreshold;
  app.scene.gsplat.minPixelSize = 1.55;
  app.scene.gsplat.minContribution = 0.58;

  return {
    backend: "WebGL2 Fallback",
    renderQuality: "Compatibility",
    fallbackMode: true,
  };
}

function getAssetLabel(assetUrl?: string, assetName?: string): string {
  if (assetName)
    return assetName;

  if (!assetUrl)
    return "Awaiting capture";

  return assetUrl.split("/").pop() ?? assetUrl;
}

function applyGsplatHardening(app: PlayCanvas.AppBase): void {
  const material = app.scene.gsplat.material;

  material.getShaderChunks("glsl").set("gsplatModifyVS", gsplatHardeningGlsl);
  material.getShaderChunks("wgsl").set("gsplatModifyVS", gsplatHardeningWgsl);
  material.update();
}

async function copyTextBestEffort(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the hidden-textarea path for embedded browsers.
    }
  }

  if (typeof document === "undefined")
    return;

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  textarea.style.inset = "0";

  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}

export const GsplatViewer = forwardRef<GsplatViewerHandle, GsplatViewerProps>(
  function GsplatViewer(
    {
      assetUrl,
      assetName,
      presets,
      initialPresetId,
      diagnostics,
      derivePresetGeometry,
      onStatsChange,
      onStateChange,
      onViewpointMotionChange,
      onViewportInteract,
    },
    ref,
  ) {
    const shouldReduceMotion = useReducedMotion();
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const appRef = useRef<PlayCanvas.AppBase | null>(null);
    const graphicsDeviceRef = useRef<PlayCanvas.GraphicsDevice | null>(null);
    const pcRef = useRef<PlayCanvasModule | null>(null);
    const cameraRef = useRef<PlayCanvas.Entity | null>(null);
    const resizeObserverRef = useRef<ResizeObserver | null>(null);
    const statsIntervalRef = useRef<number | null>(null);
    const entityRef = useRef<PlayCanvas.Entity | null>(null);
    const assetRef = useRef<PlayCanvas.Asset | null>(null);
    const blobUrlRef = useRef<string | null>(null);
    const currentPositionRef = useRef<[number, number, number]>([0, 1.4, 7.5]);
    const currentTargetRef = useRef<[number, number, number]>([0, 0.7, 0]);
    const desiredPositionRef = useRef<[number, number, number]>([0, 1.4, 7.5]);
    const desiredTargetRef = useRef<[number, number, number]>([0, 0.7, 0]);
    const orbitRef = useRef<{
      yaw: number;
      pitch: number;
      distance: number;
    }>({
      yaw: Math.PI,
      pitch: -0.08,
      distance: VIEWER_HARDENING.lookDistance,
    });
    const movementInputRef = useRef({
      forward: 0,
      strafe: 0,
      boost: false,
    });
    const movementBoundsRef = useRef<{
      minX: number;
      maxX: number;
      minZ: number;
      maxZ: number;
    } | null>(null);
    const interactionRef = useRef({
      isDragging: false,
      pointerX: 0,
      pointerY: 0,
    });
    const presetMapRef = useRef<Record<string, ViewPreset>>({});
    const presetTransitionRef = useRef<CameraTransition | null>(null);
    const heroOrbitRef = useRef<HeroOrbitState | null>(null);
    const hasPlayedHeroOrbitRef = useRef(false);
    const loadSessionRef = useRef(0);
    const initialPresetIdRef = useRef<string>(
      initialPresetId ?? presets[0]?.id ?? "",
    );
    const viewpointMotionRef = useRef(false);
    const statsRef = useRef<ViewerStats>({
      ...initialViewerStats,
      assetName: getAssetLabel(assetUrl, assetName),
      diagnosticsVisible: diagnostics?.enabledByDefault ?? false,
    });
    const animationActiveRef = useRef(false);
    const sceneReadyRef = useRef(false);
    const [loadState, setLoadState] = useState<ViewerLoadState>("idle");
    const [loadProgress, setLoadProgress] = useState(assetUrl ? 8 : 6);
    const [errorState, setErrorState] = useState<ViewerErrorState | null>(null);
    const [isDragActive, setIsDragActive] = useState(false);
    const [diagnosticsVisible, setDiagnosticsVisible] = useState(
      diagnostics?.enabledByDefault ?? false,
    );
    const [statsSnapshot, setStatsSnapshot] = useState<ViewerStats>(
      statsRef.current,
    );

    const publishStats = useCallback(
      (patch: Partial<ViewerStats>) => {
        const nextStats = { ...statsRef.current, ...patch };
        statsRef.current = nextStats;
        setStatsSnapshot(nextStats);
        onStatsChange(nextStats);
      },
      [onStatsChange],
    );

    const updateLoadState = useCallback(
      (nextState: ViewerLoadState) => {
        setLoadState(nextState);
        onStateChange(nextState);
        publishStats({ status: statusByState[nextState] });
      },
      [onStateChange, publishStats],
    );

    const setViewpointMotionState = useCallback(
      (isMoving: boolean) => {
        if (viewpointMotionRef.current === isMoving)
          return;

        viewpointMotionRef.current = isMoving;
        onViewpointMotionChange?.(isMoving);
      },
      [onViewpointMotionChange],
    );

    const clearCurrentScene = useCallback(() => {
      const activeEntity = entityRef.current;
      const activeAsset = assetRef.current;
      const activeBlobUrl = blobUrlRef.current;

      if (activeEntity) {
        activeEntity.destroy();
        entityRef.current = null;
      }

      if (activeAsset) {
        activeAsset.unload();
        appRef.current?.assets.remove(activeAsset);
        assetRef.current = null;
      }

      if (activeBlobUrl) {
        URL.revokeObjectURL(activeBlobUrl);
        blobUrlRef.current = null;
      }

      presetTransitionRef.current = null;
      heroOrbitRef.current = null;
      sceneReadyRef.current = false;
      movementBoundsRef.current = null;
      setViewpointMotionState(false);
    }, [setViewpointMotionState]);

    const beginLoadSession = useCallback(
      (nextAssetName: string) => {
        loadSessionRef.current += 1;
        const nextSessionId = loadSessionRef.current;

        clearCurrentScene();
        setErrorState(null);
        setLoadProgress(12);
        setViewpointMotionState(false);
        publishStats({
          assetName: nextAssetName,
          splatCount: null,
          fps: statsRef.current.fps,
          gpuMemoryBytes: statsRef.current.gpuMemoryBytes,
        });
        updateLoadState("loading");

        return nextSessionId;
      },
      [clearCurrentScene, publishStats, setViewpointMotionState, updateLoadState],
    );

    const syncOrbitFromPose = useCallback(() => {
      orbitRef.current = deriveLookFromPose(
        currentPositionRef.current,
        currentTargetRef.current,
      );
    }, []);

    const getCurrentViewSnapshot = useCallback((): ViewerCameraSnapshot => {
      const cameraPosition = cameraRef.current?.getPosition();
      const cameraRotation = cameraRef.current?.getEulerAngles();

      return {
        position: cameraPosition
          ? [cameraPosition.x, cameraPosition.y, cameraPosition.z]
          : copyVector(currentPositionRef.current),
        target: copyVector(currentTargetRef.current),
        rotationEuler: cameraRotation
          ? [cameraRotation.x, cameraRotation.y, cameraRotation.z]
          : [0, 0, 0],
      };
    }, []);

    const cancelHeroOrbit = useCallback(() => {
      if (!heroOrbitRef.current)
        return;

      heroOrbitRef.current = null;
      syncOrbitFromPose();
      setViewpointMotionState(false);
    }, [setViewpointMotionState, syncOrbitFromPose]);

    const applyPreset = useCallback(
      (id: string, options?: { immediate?: boolean }) => {
        const pc = pcRef.current;
        const preset = presetMapRef.current[id];

        if (!pc || !preset)
          return;

        cancelHeroOrbit();
        initialPresetIdRef.current = id;
        const nextTarget = resolveTargetFromPreset(pc, preset);

        desiredPositionRef.current = copyVector(preset.position);
        desiredTargetRef.current = copyVector(nextTarget);

        if (options?.immediate) {
          const camera = cameraRef.current;

          currentPositionRef.current = copyVector(preset.position);
          currentTargetRef.current = copyVector(nextTarget);
          animationActiveRef.current = false;
          presetTransitionRef.current = null;
          setViewpointMotionState(false);

          if (camera) {
            camera.setPosition(new pc.Vec3(...preset.position));
            camera.lookAt(new pc.Vec3(...nextTarget));
          }

          syncOrbitFromPose();
          return;
        }

        animationActiveRef.current = false;
        setViewpointMotionState(true);
        presetTransitionRef.current = {
          elapsedMs: 0,
          durationMs: preset.durationMs ?? 1200,
          targetDurationMs: (preset.durationMs ?? 1200) + 180,
          fromPosition: new pc.Vec3(...currentPositionRef.current),
          toPosition: new pc.Vec3(...preset.position),
          fromTarget: new pc.Vec3(...currentTargetRef.current),
          toTarget: new pc.Vec3(...nextTarget),
          positionScratch: new pc.Vec3(...currentPositionRef.current),
          targetScratch: new pc.Vec3(...currentTargetRef.current),
        };
      },
      [cancelHeroOrbit, setViewpointMotionState, syncOrbitFromPose],
    );

    const frameLoadedEntity = useCallback(
      async (
        pc: PlayCanvasModule,
        entity: PlayCanvas.Entity,
        resolvedAssetName: string,
        asset: PlayCanvas.Asset,
      ) => {
        const camera = cameraRef.current;

        if (!camera)
          throw new Error("Viewer camera is unavailable.");

        if (!camera.camera)
          throw new Error("Viewer camera component is unavailable.");

        updateLoadState("framing");
        setLoadProgress((currentProgress) => Math.max(currentProgress, 94));

        let customAabb: PlayCanvas.BoundingBox | null = null;
        for (let attempt = 0; attempt < 5; attempt += 1) {
          await new Promise((resolve) => window.requestAnimationFrame(resolve));
          customAabb = entity.gsplat?.customAabb ?? null;
          if (customAabb)
            break;
        }

        if (!customAabb) {
          throw new Error("The capture loaded, but its bounds were unavailable.");
        }

        const center: [number, number, number] = [
          customAabb.center.x,
          customAabb.center.y,
          customAabb.center.z,
        ];
        const halfExtents: [number, number, number] = [
          customAabb.halfExtents.x,
          customAabb.halfExtents.y,
          customAabb.halfExtents.z,
        ];

        const derivedPresets = buildFallbackPresets(center, halfExtents);
        const resolvedPresets =
          presets.length > 0
            ? derivePresetGeometry
              ? mergePresetsWithDerivedGeometry(presets, derivedPresets)
              : presets
            : derivedPresets;
        presetMapRef.current = buildPresetMap(resolvedPresets);

        const fallbackPreset = resolvedPresets[0];
        const activePreset =
          presetMapRef.current[initialPresetIdRef.current] ?? fallbackPreset;

        if (!activePreset)
          throw new Error("No valid room presets were available for camera calibration.");

        const resolvedTarget = resolveTargetFromPreset(pc, activePreset);

        currentPositionRef.current = copyVector(activePreset.position);
        desiredPositionRef.current = copyVector(activePreset.position);
        currentTargetRef.current = copyVector(resolvedTarget);
        desiredTargetRef.current = copyVector(resolvedTarget);
        animationActiveRef.current = false;
        presetTransitionRef.current = null;
        sceneReadyRef.current = true;
        setViewpointMotionState(false);
        movementBoundsRef.current = {
          minX:
            customAabb.center.x -
            customAabb.halfExtents.x -
            VIEWER_HARDENING.sceneBoundsPadding,
          maxX:
            customAabb.center.x +
            customAabb.halfExtents.x +
            VIEWER_HARDENING.sceneBoundsPadding,
          minZ:
            customAabb.center.z -
            customAabb.halfExtents.z -
            VIEWER_HARDENING.sceneBoundsPadding,
          maxZ:
            customAabb.center.z +
            customAabb.halfExtents.z +
            VIEWER_HARDENING.sceneBoundsPadding,
        };

        camera.camera.farClip = Math.max(
          120,
          distanceBetween(activePreset.position, resolvedTarget) * 18,
        );
        camera.camera.nearClip = 0.03;
        camera.setPosition(new pc.Vec3(...activePreset.position));
        camera.lookAt(new pc.Vec3(...resolvedTarget));

        syncOrbitFromPose();
        orbitRef.current.distance = Math.max(
          VIEWER_HARDENING.lookDistance,
          Math.min(orbitRef.current.distance, VIEWER_HARDENING.lookDistance * 1.35),
        );
        hasPlayedHeroOrbitRef.current = true;

        publishStats({
          assetName: resolvedAssetName,
          splatCount:
            typeof (asset.resource as { numSplats?: number } | undefined)?.numSplats ===
            "number"
              ? (asset.resource as { numSplats: number }).numSplats
              : null,
        });

        updateLoadState("ready");
        setLoadProgress(100);
      },
      [
        derivePresetGeometry,
        presets,
        publishStats,
        setViewpointMotionState,
        syncOrbitFromPose,
        updateLoadState,
      ],
    );

    const loadRemoteAsset = useCallback(
      async (url: string, nextAssetName: string) => {
        const pc = pcRef.current;
        const app = appRef.current;

        if (!pc || !app)
          return;

        const loadSessionId = beginLoadSession(nextAssetName);

        await new Promise<void>((resolve, reject) => {
          const asset = new pc.Asset(nextAssetName, "gsplat", {
            url,
          });

          const disposeAssetListeners = () => {
            asset.off("progress", handleAssetProgress);
            asset.off("load", handleAssetLoad);
            asset.off("error", handleAssetError);
          };

          const handleAssetProgress = (
            receivedBytes: number,
            totalBytes: number,
          ) => {
            if (loadSessionRef.current !== loadSessionId || totalBytes <= 0)
              return;

            const nextProgress = Math.min(
              Math.max((receivedBytes / totalBytes) * 92, 8),
              92,
            );
            setLoadProgress(nextProgress);
          };

          const handleAssetLoad = () => {
            if (loadSessionRef.current !== loadSessionId) {
              disposeAssetListeners();
              asset.unload();
              app.assets.remove(asset);
              resolve();
              return;
            }

            const entity = new pc.Entity(nextAssetName);
            entity.addComponent("gsplat", {
              asset,
              unified: true,
            });
            entity.setLocalEulerAngles(180, 0, 0);
            app.root.addChild(entity);

            assetRef.current = asset;
            entityRef.current = entity;

            void frameLoadedEntity(pc, entity, nextAssetName, asset)
              .then(() => {
                disposeAssetListeners();
                resolve();
              })
              .catch((error) => {
                disposeAssetListeners();
                reject(error);
              });
          };

          const handleAssetError = (error: unknown) => {
            disposeAssetListeners();
            if (loadSessionRef.current !== loadSessionId) {
              resolve();
              return;
            }

            reject(error);
          };

          asset.on("progress", handleAssetProgress);
          asset.once("load", handleAssetLoad);
          asset.once("error", handleAssetError);
          app.assets.add(asset);
          app.assets.load(asset);
        }).catch((error) => {
          if (loadSessionRef.current !== loadSessionId)
            return;

          setErrorState({
            eyebrow: "Asset Load Error",
            title: "Unable to open this scene.",
            detail:
              error instanceof Error
                ? error.message
                : "The configured spatial asset could not be decoded by the viewer.",
          });
          publishStats({
            assetName: nextAssetName,
            splatCount: null,
          });
          updateLoadState("error");
          setLoadProgress(100);
        });
      },
      [beginLoadSession, frameLoadedEntity, publishStats, updateLoadState],
    );

    const loadFile = useCallback(
      async (file: File) => {
        const pc = pcRef.current;
        const app = appRef.current;

        if (!pc || !app) {
          setErrorState({
            eyebrow: "Viewer Unavailable",
            title: "Viewer still waking up.",
            detail: "The viewer is still initializing. Give it a second and try again.",
          });
          updateLoadState("error");
          setLoadProgress(100);
          return;
        }

        const normalizedName = file.name.toLowerCase();
        const isSupported =
          normalizedName.endsWith(".ply") || normalizedName.endsWith(".sog");

        if (!isSupported) {
          setErrorState({
            eyebrow: "Unsupported Spatial Format",
            title: "Unsupported scene format.",
            detail: "Use a `.ply` or `.sog` capture when replacing the active scene.",
          });
          updateLoadState("error");
          setLoadProgress(100);
          return;
        }

        const loadSessionId = beginLoadSession(file.name);
        setLoadProgress(26);

        const nextBlobUrl = URL.createObjectURL(file);
        blobUrlRef.current = nextBlobUrl;

        try {
          const asset = await new Promise<PlayCanvas.Asset>((resolve, reject) => {
            app.assets.loadFromUrlAndFilename(
              nextBlobUrl,
              file.name,
              "gsplat",
              (error, loadedAsset) => {
                if (error || !loadedAsset) {
                  reject(new Error(error ?? "The capture could not be loaded."));
                  return;
                }

                resolve(loadedAsset);
              },
            );
          });

          if (loadSessionRef.current !== loadSessionId) {
            asset.unload();
            app.assets.remove(asset);
            URL.revokeObjectURL(nextBlobUrl);
            return;
          }

          const entity = new pc.Entity(file.name);
          entity.addComponent("gsplat", {
            asset,
            unified: true,
          });
          entity.setLocalEulerAngles(180, 0, 0);
          app.root.addChild(entity);

          assetRef.current = asset;
          entityRef.current = entity;

          await frameLoadedEntity(pc, entity, file.name, asset);
        } catch (error) {
          if (loadSessionRef.current !== loadSessionId) {
            URL.revokeObjectURL(nextBlobUrl);
            return;
          }

          setErrorState({
            eyebrow: "Asset Load Error",
            title: "Unable to open this scene.",
            detail:
              error instanceof Error
                ? error.message
                : "The replacement capture failed to load. Try a different `.ply` or `.sog` file.",
          });
          publishStats({
            assetName: file.name,
            splatCount: null,
          });
          updateLoadState("error");
          setLoadProgress(100);
        }
      },
      [beginLoadSession, frameLoadedEntity, publishStats, updateLoadState],
    );

    useImperativeHandle(
      ref,
      () => ({
        focusPreset(id) {
          applyPreset(id);
        },
        openFilePicker() {
          inputRef.current?.click();
        },
        copyCurrentView() {
          const snapshot = getCurrentViewSnapshot();
          const payload = {
            position: snapshot.position,
            target: snapshot.target,
            rotationEuler: snapshot.rotationEuler,
          };

          console.info("[AetherView] View vectors", payload);

          void copyTextBestEffort(
            `position: [${payload.position.join(", ")}],\nrotationEuler: [${payload.rotationEuler.join(", ")}],\ntarget: [${payload.target.join(", ")}]`,
          );

          return snapshot;
        },
      }),
      [applyPreset, getCurrentViewSnapshot],
    );

    useEffect(() => {
      publishStats({ diagnosticsVisible });
    }, [diagnosticsVisible, publishStats]);

    useEffect(() => {
      const shortcutKey = (diagnostics?.shortcutKey ?? "d").toLowerCase();

      const handleKeyDown = (event: KeyboardEvent) => {
        if (!event.shiftKey || event.key.toLowerCase() !== shortcutKey)
          return;

        event.preventDefault();
        setDiagnosticsVisible((current) => !current);
      };

      window.addEventListener("keydown", handleKeyDown);

      return () => {
        window.removeEventListener("keydown", handleKeyDown);
      };
    }, [diagnostics?.shortcutKey]);

    useEffect(() => {
      const diagnosticsShortcut = (diagnostics?.shortcutKey ?? "d").toLowerCase();

      const updateMovementState = (event: KeyboardEvent, isPressed: boolean) => {
        const targetElement = event.target as HTMLElement | null;
        const tagName = targetElement?.tagName;

        if (
          targetElement?.isContentEditable ||
          tagName === "INPUT" ||
          tagName === "TEXTAREA" ||
          tagName === "SELECT"
        ) {
          return;
        }

        if (event.shiftKey && event.key.toLowerCase() === diagnosticsShortcut)
          return;

        let didHandle = true;

        switch (event.key) {
          case "ArrowUp":
          case "w":
          case "W":
            movementInputRef.current.forward = isPressed ? 1 : 0;
            break;
          case "ArrowDown":
          case "s":
          case "S":
            movementInputRef.current.forward = isPressed ? -1 : 0;
            break;
          case "ArrowLeft":
          case "a":
          case "A":
            movementInputRef.current.strafe = isPressed ? -1 : 0;
            break;
          case "ArrowRight":
          case "d":
          case "D":
            movementInputRef.current.strafe = isPressed ? 1 : 0;
            break;
          case "Shift":
            movementInputRef.current.boost = isPressed;
            break;
          default:
            didHandle = false;
        }

        if (!didHandle)
          return;

        event.preventDefault();
        cancelHeroOrbit();
        if (isPressed) {
          presetTransitionRef.current = null;
          animationActiveRef.current = false;
          setViewpointMotionState(true);
          onViewportInteract?.();
          return;
        }

        if (
          movementInputRef.current.forward === 0 &&
          movementInputRef.current.strafe === 0
        ) {
          setViewpointMotionState(false);
        }
      };

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.repeat && event.key !== "Shift")
          return;

        updateMovementState(event, true);
      };

      const handleKeyUp = (event: KeyboardEvent) => {
        updateMovementState(event, false);
      };

      window.addEventListener("keydown", handleKeyDown);
      window.addEventListener("keyup", handleKeyUp);

      return () => {
        window.removeEventListener("keydown", handleKeyDown);
        window.removeEventListener("keyup", handleKeyUp);
      };
    }, [cancelHeroOrbit, diagnostics?.shortcutKey, onViewportInteract, setViewpointMotionState]);

    useEffect(() => {
      let isMounted = true;
      let destroyListeners: Array<() => void> = [];

      async function initialize(): Promise<void> {
        const canvas = canvasRef.current;
        const viewport = viewportRef.current;

        if (!canvas || !viewport)
          return;

        try {
          const pc = await import("playcanvas");
          if (!isMounted)
            return;

          pcRef.current = pc;
          initialPresetIdRef.current = initialPresetId ?? presets[0]?.id ?? "";

          const deviceTypes: Array<
            typeof pc.DEVICETYPE_WEBGPU | typeof pc.DEVICETYPE_WEBGL2
          > = [pc.DEVICETYPE_WEBGL2];
          const navigatorWithGpu = navigator as Navigator & {
            gpu?: {
              requestAdapter?: (options?: {
                powerPreference?: "high-performance" | "low-power";
              }) => Promise<unknown | null>;
            };
          };

          if (navigatorWithGpu.gpu?.requestAdapter) {
            try {
              const adapter = await navigatorWithGpu.gpu.requestAdapter({
                powerPreference: "high-performance",
              });

              if (adapter)
                deviceTypes.unshift(pc.DEVICETYPE_WEBGPU);
            } catch {
              // If adapter negotiation fails, continue with WebGL2 fallback only.
            }
          }

          const graphicsDevice = await pc.createGraphicsDevice(canvas, {
            deviceTypes,
            powerPreference: "high-performance",
            antialias: false,
          });

          if (!isMounted) {
            graphicsDevice.destroy();
            return;
          }

          graphicsDeviceRef.current = graphicsDevice;
          graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);

          const appOptions = new pc.AppOptions();
          appOptions.graphicsDevice = graphicsDevice;
          appOptions.mouse = new pc.Mouse(canvas);
          appOptions.touch = new pc.TouchDevice(canvas);
          appOptions.componentSystems = [
            pc.RenderComponentSystem,
            pc.CameraComponentSystem,
            pc.LightComponentSystem,
            pc.ScriptComponentSystem,
            pc.GSplatComponentSystem,
          ];
          appOptions.resourceHandlers = [
            pc.TextureHandler,
            pc.ContainerHandler,
            pc.ScriptHandler,
            pc.GSplatHandler,
          ];

          const app = new pc.AppBase(canvas);
          app.init(appOptions);
          appRef.current = app;

          app.setCanvasFillMode(pc.FILLMODE_NONE);
          app.setCanvasResolution(pc.RESOLUTION_AUTO);
          app.scene.ambientLight = new pc.Color(0.12, 0.12, 0.11);

          const renderProfile = applyRenderProfile(pc, app, graphicsDevice);
          applyGsplatHardening(app);

          const camera = new pc.Entity("viewer-camera");
          camera.addComponent("camera", {
            clearColor: new pc.Color(0.035, 0.036, 0.04),
            fov: VIEWER_HARDENING.cameraFov,
            nearClip: 0.03,
            farClip: 1000,
            toneMapping: pc.TONEMAP_ACES,
          });
          app.root.addChild(camera);
          cameraRef.current = camera;

          const light = new pc.Entity("viewer-light");
          light.addComponent("light", {
            type: "directional",
            color: new pc.Color(0.92, 0.9, 0.86),
            intensity: 1.05,
          });
          light.setLocalEulerAngles(45, 25, 0);
          app.root.addChild(light);

          const currentPosition = new pc.Vec3(...currentPositionRef.current);
          const desiredPosition = new pc.Vec3(...desiredPositionRef.current);
          const currentTarget = new pc.Vec3(...currentTargetRef.current);
          const desiredTarget = new pc.Vec3(...desiredTargetRef.current);
          const distanceThreshold = 0.02;

          const resizeCanvas = () => {
            if (!viewportRef.current || !appRef.current || !graphicsDeviceRef.current)
              return;

            const width = viewportRef.current.clientWidth;
            const height = viewportRef.current.clientHeight;

            if (width <= 0 || height <= 0)
              return;

            const maxPixelRatio =
              renderProfile.fallbackMode ? 1.35 : 2;
            graphicsDeviceRef.current.maxPixelRatio = Math.min(
              window.devicePixelRatio || 1,
              maxPixelRatio,
            );
            appRef.current.resizeCanvas(width, height);
          };

          const commitCameraPose = () => {
            currentPositionRef.current = [
              currentPosition.x,
              currentPosition.y,
              currentPosition.z,
            ];
            currentTargetRef.current = [
              currentTarget.x,
              currentTarget.y,
              currentTarget.z,
            ];
            camera.setPosition(currentPosition);
            camera.lookAt(currentTarget);
          };

          const syncDesiredOrbitPosition = () => {
            const direction = directionFromYawPitch(
              orbitRef.current.yaw,
              orbitRef.current.pitch,
            );
            desiredPositionRef.current = copyVector(currentPositionRef.current);
            desiredTargetRef.current = [
              currentPositionRef.current[0] + direction[0] * orbitRef.current.distance,
              currentPositionRef.current[1] + direction[1] * orbitRef.current.distance,
              currentPositionRef.current[2] + direction[2] * orbitRef.current.distance,
            ];
            animationActiveRef.current = true;
          };

          const cancelPresetTransition = () => {
            if (!presetTransitionRef.current)
              return;

            presetTransitionRef.current = null;
            setViewpointMotionState(false);
            syncOrbitFromPose();
          };

          const handlePointerDown = (event: PointerEvent) => {
            interactionRef.current.isDragging = true;
            interactionRef.current.pointerX = event.clientX;
            interactionRef.current.pointerY = event.clientY;
            cancelHeroOrbit();
            cancelPresetTransition();
            onViewportInteract?.();
            canvas.setPointerCapture(event.pointerId);
          };

          const handlePointerMove = (event: PointerEvent) => {
            if (!interactionRef.current.isDragging || !sceneReadyRef.current)
              return;

            const deltaX = event.clientX - interactionRef.current.pointerX;
            const deltaY = event.clientY - interactionRef.current.pointerY;

            interactionRef.current.pointerX = event.clientX;
            interactionRef.current.pointerY = event.clientY;

            orbitRef.current.yaw -= deltaX * 0.008;
            orbitRef.current.pitch = clamp(
              orbitRef.current.pitch - deltaY * 0.006,
              -1.24,
              1.24,
            );

            syncDesiredOrbitPosition();
          };

          const handlePointerUp = (event: PointerEvent) => {
            interactionRef.current.isDragging = false;
            if (canvas.hasPointerCapture(event.pointerId)) {
              canvas.releasePointerCapture(event.pointerId);
            }
          };

          const handleWheel = (event: WheelEvent) => {
            if (!sceneReadyRef.current)
              return;

            event.preventDefault();
            cancelHeroOrbit();
            cancelPresetTransition();

            orbitRef.current.distance = clamp(
              orbitRef.current.distance * (event.deltaY > 0 ? 1.08 : 0.92),
              2,
              12,
            );

            syncDesiredOrbitPosition();
          };

          canvas.style.touchAction = "none";
          canvas.addEventListener("pointerdown", handlePointerDown);
          canvas.addEventListener("pointermove", handlePointerMove);
          canvas.addEventListener("pointerup", handlePointerUp);
          canvas.addEventListener("pointerleave", handlePointerUp);
          canvas.addEventListener("wheel", handleWheel, { passive: false });

          destroyListeners = [
            () => canvas.removeEventListener("pointerdown", handlePointerDown),
            () => canvas.removeEventListener("pointermove", handlePointerMove),
            () => canvas.removeEventListener("pointerup", handlePointerUp),
            () => canvas.removeEventListener("pointerleave", handlePointerUp),
            () => canvas.removeEventListener("wheel", handleWheel),
          ];

          resizeObserverRef.current = new ResizeObserver(() => {
            resizeCanvas();
          });
          resizeObserverRef.current.observe(viewport);

          app.on("update", (deltaTime: number) => {
            desiredPosition.set(...desiredPositionRef.current);
            desiredTarget.set(...desiredTargetRef.current);

            const heroOrbit = heroOrbitRef.current;
            const presetTransition = presetTransitionRef.current;
            const hasKeyboardMovement =
              movementInputRef.current.forward !== 0 ||
              movementInputRef.current.strafe !== 0;
            const isCameraInMotion =
              heroOrbit !== null ||
              presetTransition !== null ||
              hasKeyboardMovement ||
              animationActiveRef.current;

            if (isCameraInMotion) {
              app.scene.gsplat.dirty = true;
            }

            if (heroOrbit) {
              heroOrbit.elapsedMs += deltaTime * 1000;
              const orbitProgress = clamp(
                heroOrbit.elapsedMs / heroOrbit.durationMs,
                0,
                1,
              );
              const easedOrbit = easeInOutSine(orbitProgress);
              const nextYaw =
                heroOrbit.startYaw +
                (heroOrbit.endYaw - heroOrbit.startYaw) * easedOrbit;
              const nextPitch =
                heroOrbit.startPitch +
                (heroOrbit.endPitch - heroOrbit.startPitch) * easedOrbit;
              const nextPosition = sphericalToCartesian(
                nextYaw,
                nextPitch,
                heroOrbit.distance,
                [
                  heroOrbit.centerTarget.x,
                  heroOrbit.centerTarget.y,
                  heroOrbit.centerTarget.z,
                ],
              );

              currentPosition.set(...nextPosition);
              currentTarget.set(
                heroOrbit.centerTarget.x,
                heroOrbit.centerTarget.y,
                heroOrbit.centerTarget.z,
              );
              desiredPositionRef.current = copyVector(nextPosition);
              desiredTargetRef.current = [
                heroOrbit.centerTarget.x,
                heroOrbit.centerTarget.y,
                heroOrbit.centerTarget.z,
              ];

              if (orbitProgress >= 1) {
                heroOrbitRef.current = null;
                syncOrbitFromPose();
                setViewpointMotionState(false);
              }
            } else if (presetTransition) {
              presetTransition.elapsedMs += deltaTime * 1000;

              const positionProgress = clamp(
                presetTransition.elapsedMs / presetTransition.durationMs,
                0,
                1,
              );
              const targetProgress = clamp(
                presetTransition.elapsedMs / presetTransition.targetDurationMs,
                0,
                1,
              );
              const easedPosition = easeOutQuart(positionProgress);
              const easedTarget = easeOutCubic(targetProgress);

              presetTransition.positionScratch.lerp(
                presetTransition.fromPosition,
                presetTransition.toPosition,
                easedPosition,
              );
              presetTransition.targetScratch.lerp(
                presetTransition.fromTarget,
                presetTransition.toTarget,
                easedTarget,
              );

              currentPosition.copy(presetTransition.positionScratch);
              currentTarget.copy(presetTransition.targetScratch);

              if (positionProgress >= 1 && targetProgress >= 1) {
                currentPosition.copy(presetTransition.toPosition);
                currentTarget.copy(presetTransition.toTarget);
                presetTransitionRef.current = null;
                setViewpointMotionState(false);
                syncOrbitFromPose();
              }
            } else if (hasKeyboardMovement) {
              const movementMagnitude = Math.hypot(
                movementInputRef.current.forward,
                movementInputRef.current.strafe,
              );
              const normalizedForward =
                movementMagnitude > 0
                  ? movementInputRef.current.forward / movementMagnitude
                  : 0;
              const normalizedStrafe =
                movementMagnitude > 0
                  ? movementInputRef.current.strafe / movementMagnitude
                  : 0;
              const movementSpeed =
                VIEWER_HARDENING.walkingSpeed *
                (movementInputRef.current.boost
                  ? VIEWER_HARDENING.walkingBoost
                  : 1);
              const lockedY = currentPosition.y;

              camera.translateLocal(
                normalizedStrafe * movementSpeed * deltaTime,
                0,
                -normalizedForward * movementSpeed * deltaTime,
              );

              const translatedPosition = camera.getPosition();
              const movementBounds = movementBoundsRef.current;
              const clampedX = movementBounds
                ? clamp(
                    translatedPosition.x,
                    movementBounds.minX,
                    movementBounds.maxX,
                  )
                : translatedPosition.x;
              const clampedZ = movementBounds
                ? clamp(
                    translatedPosition.z,
                    movementBounds.minZ,
                    movementBounds.maxZ,
                  )
                : translatedPosition.z;
              const lookDirection = directionFromYawPitch(
                orbitRef.current.yaw,
                orbitRef.current.pitch,
              );

              currentPosition.set(clampedX, lockedY, clampedZ);
              currentTarget.set(
                clampedX + lookDirection[0] * orbitRef.current.distance,
                lockedY + lookDirection[1] * orbitRef.current.distance,
                clampedZ + lookDirection[2] * orbitRef.current.distance,
              );
              desiredPositionRef.current = [clampedX, lockedY, clampedZ];
              desiredTargetRef.current = [
                currentTarget.x,
                currentTarget.y,
                currentTarget.z,
              ];
              animationActiveRef.current = false;
              setViewpointMotionState(true);
            } else if (animationActiveRef.current) {
              setViewpointMotionState(true);
              currentPosition.lerp(currentPosition, desiredPosition, 0.16);
              currentTarget.lerp(currentTarget, desiredTarget, 0.1);

              const isSettled =
                distanceBetween(
                  [currentPosition.x, currentPosition.y, currentPosition.z],
                  desiredPositionRef.current,
                ) < distanceThreshold &&
                distanceBetween(
                  [currentTarget.x, currentTarget.y, currentTarget.z],
                  desiredTargetRef.current,
                ) < distanceThreshold;

              if (isSettled) {
                currentPosition.copy(desiredPosition);
                currentTarget.copy(desiredTarget);
                animationActiveRef.current = false;
                setViewpointMotionState(false);
                syncOrbitFromPose();
              }
            }

            commitCameraPose();
          });

          app.start();
          resizeCanvas();
          commitCameraPose();

          statsIntervalRef.current = window.setInterval(() => {
            if (!appRef.current || !graphicsDeviceRef.current)
              return;

            const fps = Math.round(appRef.current.stats.frame.fps || 0);
            publishStats({
              fps,
              gpuMemoryBytes: getGpuMemoryBytes(
                appRef.current,
                graphicsDeviceRef.current,
              ),
            });
          }, 250);

          publishStats({
            backend: renderProfile.backend,
            renderQuality: renderProfile.renderQuality,
            fallbackMode: renderProfile.fallbackMode,
            assetName: getAssetLabel(assetUrl, assetName),
          });

          if (assetUrl) {
            void loadRemoteAsset(assetUrl, getAssetLabel(assetUrl, assetName));
          } else {
            setLoadProgress(6);
            updateLoadState("idle");
          }
        } catch (error) {
          if (!isMounted)
            return;

          setErrorState({
            eyebrow: "Viewer Initialization",
            title: "Unable to open this scene.",
            detail:
              error instanceof Error
                ? error.message
                : "The PlayCanvas viewer could not be initialized on this device.",
          });
          publishStats({
            backend: "Unavailable",
            assetName: "Viewer unavailable",
            splatCount: null,
            fps: null,
            gpuMemoryBytes: null,
          });
          updateLoadState("error");
          setLoadProgress(100);
        }
      }

      void initialize();

      return () => {
        isMounted = false;
        setViewpointMotionState(false);

        destroyListeners.forEach((destroyListener) => destroyListener());
        resizeObserverRef.current?.disconnect();
        resizeObserverRef.current = null;

        if (statsIntervalRef.current !== null) {
          window.clearInterval(statsIntervalRef.current);
          statsIntervalRef.current = null;
        }

        clearCurrentScene();
        loadSessionRef.current += 1;
        appRef.current?.destroy();
        appRef.current = null;
        graphicsDeviceRef.current = null;
        cameraRef.current = null;
        pcRef.current = null;
      };
    }, [
      assetName,
      assetUrl,
      cancelHeroOrbit,
      clearCurrentScene,
      beginLoadSession,
      initialPresetId,
      loadRemoteAsset,
      onViewportInteract,
      presets,
      publishStats,
      syncOrbitFromPose,
      updateLoadState,
      setViewpointMotionState,
    ]);

    const hasLoadedAsset = statsSnapshot.status === "ready";
    const showEmptyState =
      !assetUrl &&
      !hasLoadedAsset &&
      loadState !== "loading" &&
      loadState !== "framing" &&
      !errorState;
    const showCenterPrompt = showEmptyState || isDragActive;
    const showMonogramPrompt = showEmptyState && !isDragActive;
    const motionSpring = shouldReduceMotion
      ? { duration: 0.01 }
      : { type: "spring" as const, stiffness: 100, damping: 20, mass: 0.92 };
    const overlayEase = shouldReduceMotion
      ? { duration: 0.01 }
      : { duration: 0.34, ease: [0.22, 1, 0.36, 1] as const };
    const promptEyebrow = isDragActive ? "Scene swap" : "AETHERVIEW";
    const promptTitle = isDragActive
      ? "Release to replace the active scene."
      : showMonogramPrompt
        ? "Drop to Begin"
        : "Drop a splat file to open the space.";
    const promptBody = isDragActive
      ? "The new capture will rebuild in place while keeping the HUD anchored around the scene."
      : showMonogramPrompt
        ? "Drag a `.ply` or `.sog` scan into the viewport, or choose a capture to launch the spatial review."
        : "Use a `.ply` or `.sog` file to begin a full-screen review, or replace the current scene from the dock below.";
    const loadingTitle =
      loadState === "loading"
        ? "Preparing scene..."
        : "Settling first frame...";
    const loadingBody =
      loadState === "loading"
        ? "Bringing the capture into focus, staging GPU resources, and preparing the first camera pass."
        : "Balancing splats and smoothing the opening frame for review.";
    const bloomProgress =
      loadState === "ready"
        ? 1
        : loadState === "idle"
          ? 0.12
          : clamp(loadProgress / 100, 0.12, 1);
    const bloomOpacity = showMonogramPrompt
      ? 0.24
      : 0.12 + bloomProgress * 0.18;
    const bloomScale = 1 + bloomProgress * 0.08;
    const bloomTranslateX = (bloomProgress - 0.5) * 4;

    return (
      <div
        ref={viewportRef}
        className={`relative isolate h-full min-h-screen overflow-hidden bg-[#040506] ${
          isDragActive ? "ring-2 ring-inset ring-[#8ea8ff]/55" : ""
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragActive(true);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null))
            return;

          setIsDragActive(false);
        }}
        onDrop={(event: DragEvent<HTMLDivElement>) => {
          event.preventDefault();
          setIsDragActive(false);

          const droppedFile = event.dataTransfer.files[0];
          if (!droppedFile)
            return;

          void loadFile(droppedFile);
        }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 z-0 h-full w-full" />
        <input
          ref={inputRef}
          type="file"
          accept=".ply,.sog"
          hidden
          aria-hidden="true"
          className="hidden"
          style={{ display: "none" }}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            const selectedFile = event.target.files?.[0];
            event.target.value = "";

            if (!selectedFile)
              return;

            void loadFile(selectedFile);
          }}
        />

        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-[-12%] z-0 bg-[radial-gradient(circle_at_top,rgba(108,157,255,0.34),transparent_38%),radial-gradient(circle_at_76%_16%,rgba(212,190,152,0.18),transparent_24%),radial-gradient(circle_at_bottom,rgba(255,255,255,0.05),transparent_22%)] blur-3xl"
          animate={{
            opacity: bloomOpacity,
            scale: bloomScale,
            x: `${bloomTranslateX}%`,
          }}
          transition={shouldReduceMotion ? { duration: 0.01 } : { duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        />
        <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_top,rgba(79,120,188,0.14),transparent_30%),radial-gradient(circle_at_bottom,rgba(255,255,255,0.04),transparent_20%),linear-gradient(180deg,rgba(2,4,7,0.16),rgba(2,4,7,0.04)_34%,rgba(2,4,7,0.22))]" />

        <AnimatePresence mode="wait">
          {showCenterPrompt ? (
            <motion.div
              key={isDragActive ? "drop-prompt" : "empty-prompt"}
              initial={shouldReduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={overlayEase}
              className="absolute inset-0 z-20 flex items-center justify-center p-6"
            >
              <motion.div
                initial={
                  shouldReduceMotion
                    ? false
                    : { opacity: 0, y: 30, scale: 0.95, filter: "blur(14px)" }
                }
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={
                  shouldReduceMotion
                    ? { opacity: 0 }
                    : { opacity: 0, y: -28, scale: 1.05, filter: "blur(16px)" }
                }
                transition={motionSpring}
                className="max-w-2xl rounded-[2.2rem] border border-white/10 bg-black/20 px-8 py-9 text-center shadow-[0_24px_96px_rgba(0,0,0,0.34)] backdrop-blur-3xl"
              >
                {showMonogramPrompt ? (
                  <motion.div
                    initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.92, y: 12 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -8 }}
                    transition={{
                      ...motionSpring,
                      delay: shouldReduceMotion ? 0 : 0.02,
                    }}
                    className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(142,168,255,0.18),transparent_55%),rgba(255,255,255,0.03)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_22px_68px_rgba(0,0,0,0.28)]"
                  >
                    <motion.span
                      className="font-[family-name:var(--font-display)] text-3xl tracking-[0.18em] text-white"
                      animate={
                        shouldReduceMotion
                          ? undefined
                          : {
                              scale: [1, 1.03, 1],
                              opacity: [0.84, 1, 0.84],
                            }
                      }
                      transition={
                        shouldReduceMotion
                          ? undefined
                          : {
                              duration: 2.6,
                              repeat: Number.POSITIVE_INFINITY,
                              ease: "easeInOut",
                            }
                      }
                    >
                      AV
                    </motion.span>
                  </motion.div>
                ) : null}
                <motion.p
                  initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                  transition={{
                    ...overlayEase,
                    delay: shouldReduceMotion ? 0 : 0.03,
                  }}
                  className="text-[0.68rem] uppercase tracking-[0.38em] text-[#8ea8ff]"
                >
                  {promptEyebrow}
                </motion.p>
                <motion.h2
                  initial={shouldReduceMotion ? false : { opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={
                    shouldReduceMotion
                      ? { opacity: 0 }
                      : { opacity: 0, y: -12, filter: "blur(10px)" }
                  }
                  transition={{
                    ...motionSpring,
                    delay: shouldReduceMotion ? 0 : 0.05,
                  }}
                  className="mt-4 text-[clamp(2rem,4vw,3.3rem)] font-semibold leading-none tracking-[-0.05em] text-white"
                >
                  {promptTitle}
                </motion.h2>
                <motion.p
                  initial={shouldReduceMotion ? false : { opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={
                    shouldReduceMotion
                      ? { opacity: 0 }
                      : { opacity: 0, y: -10, filter: "blur(10px)" }
                  }
                  transition={{
                    ...overlayEase,
                    delay: shouldReduceMotion ? 0 : 0.08,
                  }}
                  className="mx-auto mt-5 max-w-xl text-sm leading-7 text-white/66"
                >
                  {promptBody}
                </motion.p>
                <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                  <motion.button
                    type="button"
                    className="focus-ring pointer-events-auto rounded-full border border-white/10 bg-white/[0.08] px-6 py-3 text-sm font-medium text-white transition-all duration-300 ease-out hover:scale-[1.02] hover:border-[#8ea8ff]/35 hover:bg-white/[0.12] hover:shadow-[0_0_0_1px_rgba(142,168,255,0.12),0_18px_44px_rgba(59,130,246,0.16)]"
                    initial={shouldReduceMotion ? false : { opacity: 0, x: -20, y: 10 }}
                    animate={{ opacity: 1, x: 0, y: 0 }}
                    exit={
                      shouldReduceMotion
                        ? { opacity: 0 }
                        : { opacity: 0, x: -24, y: 14, scale: 0.97 }
                    }
                    transition={{
                      ...motionSpring,
                      delay: shouldReduceMotion ? 0 : 0.12,
                    }}
                    whileHover={shouldReduceMotion ? undefined : { scale: 1.02, y: -1 }}
                    whileTap={shouldReduceMotion ? undefined : { scale: 0.985 }}
                    onClick={() => inputRef.current?.click()}
                  >
                    {isDragActive ? "Swap active capture" : "Choose capture"}
                  </motion.button>
                  <motion.div
                    className={`${floatingChipClass} px-5 py-3 font-[family-name:var(--font-mono)] text-[0.72rem] uppercase tracking-[0.22em] text-white/56`}
                    initial={shouldReduceMotion ? false : { opacity: 0, x: 20, y: 10 }}
                    animate={{ opacity: 1, x: 0, y: 0 }}
                    exit={
                      shouldReduceMotion
                        ? { opacity: 0 }
                        : { opacity: 0, x: 24, y: 14, scale: 0.97 }
                    }
                    transition={{
                      ...overlayEase,
                      delay: shouldReduceMotion ? 0 : 0.16,
                    }}
                  >
                    PLY / SOG
                  </motion.div>
                </div>
              </motion.div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <AnimatePresence>
          {loadState === "loading" || loadState === "framing" ? (
            <motion.div
              initial={shouldReduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={overlayEase}
              className="absolute inset-0 z-20 flex items-center justify-center bg-[linear-gradient(180deg,rgba(3,5,8,0.46),rgba(3,5,8,0.62))] p-6 backdrop-blur-sm"
            >
              <motion.div
                initial={
                  shouldReduceMotion
                    ? false
                    : { opacity: 0, y: 22, scale: 0.97, filter: "blur(12px)" }
                }
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={
                  shouldReduceMotion
                    ? { opacity: 0 }
                    : { opacity: 0, y: -18, scale: 0.98, filter: "blur(10px)" }
                }
                transition={motionSpring}
                className="w-full max-w-lg rounded-[1.8rem] border border-white/10 bg-black/20 px-7 py-8 shadow-[0_24px_96px_rgba(0,0,0,0.34)] backdrop-blur-3xl"
              >
              <p className="text-[0.68rem] uppercase tracking-[0.34em] text-[#8ea8ff]">
                {loadingTitle}
              </p>
              <p className="mt-3 text-sm leading-7 text-white/66">
                {loadingBody}
              </p>
              <div className="mt-6 h-2 rounded-full bg-white/8">
                <motion.div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#3b82f6,#78a6ff)] transition-[width] duration-500 ease-out"
                  animate={{ width: `${loadProgress}%` }}
                  transition={
                    shouldReduceMotion
                      ? { duration: 0.01 }
                      : { duration: 0.48, ease: [0.22, 1, 0.36, 1] }
                  }
                />
              </div>
              <div className="mt-3 flex items-center justify-between font-[family-name:var(--font-mono)] text-[0.72rem] uppercase tracking-[0.22em] text-white/48">
                <span>{statsSnapshot.backend}</span>
                <span>{Math.round(loadProgress)}%</span>
              </div>
              </motion.div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <AnimatePresence>
          {errorState ? (
            <motion.div
              initial={shouldReduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={overlayEase}
              className="absolute inset-0 z-20 flex items-center justify-center p-6"
            >
            <motion.div
              initial={
                shouldReduceMotion
                  ? false
                  : { opacity: 0, y: 24, scale: 0.96, filter: "blur(14px)" }
              }
              animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
              exit={
                shouldReduceMotion
                  ? { opacity: 0 }
                  : { opacity: 0, y: -18, scale: 0.98, filter: "blur(12px)" }
              }
              transition={motionSpring}
              className="max-w-2xl rounded-[2rem] border border-white/10 bg-black/20 px-7 py-8 text-center shadow-[0_24px_96px_rgba(0,0,0,0.34)] backdrop-blur-3xl"
            >
              <p className="text-[0.68rem] uppercase tracking-[0.34em] text-[var(--tone-brass)]">
                {errorState.eyebrow}
              </p>
              <h2 className="mt-4 text-[clamp(2.1rem,4.2vw,3.2rem)] font-semibold leading-none tracking-[-0.05em] text-white">
                {errorState.title}
              </h2>
              <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-white/66">
                {errorState.detail}
              </p>
              <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <button
                  type="button"
                  className="focus-ring pointer-events-auto rounded-full border border-white/10 bg-white/[0.08] px-6 py-3 text-sm font-medium text-white transition-all duration-300 ease-out hover:scale-[1.02] hover:border-[#8ea8ff]/34 hover:bg-white/[0.12] hover:shadow-[0_0_0_1px_rgba(142,168,255,0.12),0_18px_44px_rgba(59,130,246,0.16)]"
                  onClick={() => inputRef.current?.click()}
                >
                  Choose another scene
                </button>
                <div className={`${floatingChipClass} px-5 py-3 font-[family-name:var(--font-mono)] text-[0.72rem] uppercase tracking-[0.22em] text-white/56`}>
                  /public/assets/property-scan.ply or drag a replacement
                </div>
              </div>
            </motion.div>
          </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    );
  },
);
