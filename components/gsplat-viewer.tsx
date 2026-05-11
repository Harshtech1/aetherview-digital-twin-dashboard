"use client";

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

type PlayCanvasModule = typeof import("playcanvas");

export interface ViewPreset {
  id: "front" | "angle" | "focus";
  label: string;
  position: [number, number, number];
  target: [number, number, number];
}

export type ViewerLoadState = "idle" | "loading" | "framing" | "ready" | "error";

export interface ViewerStats {
  backend: string;
  assetName: string;
  splatCount: number | null;
  fps: number | null;
  status: "Idle" | "Loading" | "Ready" | "Error";
}

export interface GsplatViewerHandle {
  focusPreset: (id: ViewPreset["id"]) => void;
  openFilePicker: () => void;
}

interface GsplatViewerProps {
  onStatsChange: (stats: ViewerStats) => void;
  onStateChange: (state: ViewerLoadState) => void;
}

const initialViewerStats: ViewerStats = {
  backend: "Initializing",
  assetName: "Awaiting capture",
  splatCount: null,
  fps: null,
  status: "Idle",
};

const progressByState: Record<ViewerLoadState, number> = {
  idle: 6,
  loading: 38,
  framing: 76,
  ready: 100,
  error: 100,
};

const statusByState: Record<ViewerLoadState, ViewerStats["status"]> = {
  idle: "Idle",
  loading: "Loading",
  framing: "Loading",
  ready: "Ready",
  error: "Error",
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function distanceBetween(a: readonly number[], b: readonly number[]) {
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

function deriveOrbitFromPose(
  position: readonly number[],
  target: readonly number[],
): { yaw: number; pitch: number; distance: number } {
  const offsetX = position[0] - target[0];
  const offsetY = position[1] - target[1];
  const offsetZ = position[2] - target[2];
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

function buildPresets(
  center: readonly number[],
  halfExtents: readonly number[],
): Record<ViewPreset["id"], ViewPreset> {
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

  return {
    front: {
      id: "front",
      label: "Front",
      position: [center[0], center[1] + radius * 0.18, center[2] + radius * 2.25],
      target: elevatedTarget,
    },
    angle: {
      id: "angle",
      label: "Angle",
      position: [
        center[0] + radius * 1.45,
        center[1] + radius * 0.62,
        center[2] + radius * 1.45,
      ],
      target: elevatedTarget,
    },
    focus: {
      id: "focus",
      label: "Focus",
      position: [center[0], center[1] + radius * 0.34, center[2] + radius * 1.08],
      target: [center[0], center[1] + halfExtents[1] * 0.28, center[2]],
    },
  };
}

export const GsplatViewer = forwardRef<GsplatViewerHandle, GsplatViewerProps>(
  function GsplatViewer({ onStatsChange, onStateChange }, ref) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const appRef = useRef<PlayCanvas.AppBase | null>(null);
    const pcRef = useRef<PlayCanvasModule | null>(null);
    const cameraRef = useRef<PlayCanvas.Entity | null>(null);
    const resizeObserverRef = useRef<ResizeObserver | null>(null);
    const fpsIntervalRef = useRef<number | null>(null);
    const entityRef = useRef<PlayCanvas.Entity | null>(null);
    const assetRef = useRef<PlayCanvas.Asset | null>(null);
    const blobUrlRef = useRef<string | null>(null);
    const currentPositionRef = useRef<[number, number, number]>([0, 1.4, 7.5]);
    const currentTargetRef = useRef<[number, number, number]>([0, 0.7, 0]);
    const desiredPositionRef = useRef<[number, number, number]>([0, 1.4, 7.5]);
    const desiredTargetRef = useRef<[number, number, number]>([0, 0.7, 0]);
    const orbitRef = useRef({ yaw: 0, pitch: -0.1, distance: 7.5 });
    const interactionRef = useRef({
      isDragging: false,
      pointerX: 0,
      pointerY: 0,
    });
    const presetMapRef = useRef<Record<ViewPreset["id"], ViewPreset> | null>(null);
    const statsRef = useRef<ViewerStats>(initialViewerStats);
    const loadStateRef = useRef<ViewerLoadState>("idle");
    const animationActiveRef = useRef(false);
    const sceneReadyRef = useRef(false);
    const [loadState, setLoadState] = useState<ViewerLoadState>("idle");
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [isDragActive, setIsDragActive] = useState(false);

    const publishStats = useCallback((patch: Partial<ViewerStats>) => {
      statsRef.current = { ...statsRef.current, ...patch };
      onStatsChange(statsRef.current);
    }, [onStatsChange]);

    const updateLoadState = useCallback((nextState: ViewerLoadState) => {
      loadStateRef.current = nextState;
      setLoadState(nextState);
      onStateChange(nextState);
      publishStats({ status: statusByState[nextState] });
    }, [onStateChange, publishStats]);

    function clearCurrentScene() {
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

      presetMapRef.current = null;
      sceneReadyRef.current = false;
    }

    function syncOrbitFromPose() {
      orbitRef.current = deriveOrbitFromPose(
        currentPositionRef.current,
        currentTargetRef.current,
      );
    }

    function applyPreset(id: ViewPreset["id"]) {
      const preset = presetMapRef.current?.[id];

      if (!preset) return;

      desiredPositionRef.current = copyVector(preset.position);
      desiredTargetRef.current = copyVector(preset.target);
      animationActiveRef.current = true;
    }

    async function frameLoadedEntity(
      pc: PlayCanvasModule,
      entity: PlayCanvas.Entity,
      filename: string,
      asset: PlayCanvas.Asset,
    ) {
      const camera = cameraRef.current;

      if (!camera) throw new Error("Viewer camera is unavailable.");
      if (!camera.camera) throw new Error("Viewer camera component is unavailable.");

      updateLoadState("framing");

      let customAabb: PlayCanvas.BoundingBox | null = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await new Promise((resolve) => window.requestAnimationFrame(resolve));
        customAabb = entity.gsplat?.customAabb ?? null;
        if (customAabb) break;
      }

      if (!customAabb) throw new Error("The capture loaded, but its bounds were unavailable.");

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
      const presets = buildPresets(center, halfExtents);
      const frontPreset = presets.front;

      presetMapRef.current = presets;
      currentTargetRef.current = copyVector(frontPreset.target);
      desiredTargetRef.current = copyVector(frontPreset.target);
      currentPositionRef.current = copyVector(frontPreset.position);
      desiredPositionRef.current = copyVector(frontPreset.position);
      syncOrbitFromPose();

      camera.camera.farClip = Math.max(120, orbitRef.current.distance * 18);
      camera.camera.nearClip = 0.03;
      animationActiveRef.current = false;
      sceneReadyRef.current = true;

      publishStats({
        assetName: filename,
        splatCount:
          typeof (asset.resource as { numSplats?: number } | undefined)?.numSplats ===
          "number"
            ? (asset.resource as { numSplats: number }).numSplats
            : null,
      });

      updateLoadState("ready");

      const posePosition = new pc.Vec3(...frontPreset.position);
      const poseTarget = new pc.Vec3(...frontPreset.target);
      camera.setPosition(posePosition);
      camera.lookAt(poseTarget);
    }

    async function loadFile(file: File) {
      const pc = pcRef.current;
      const app = appRef.current;

      if (!pc || !app) {
        setErrorMessage("The viewer is still initializing. Give it a second and try again.");
        updateLoadState("error");
        return;
      }

      const normalizedName = file.name.toLowerCase();
      const isSupported =
        normalizedName.endsWith(".ply") || normalizedName.endsWith(".sog");

      if (!isSupported) {
        setErrorMessage("Drop a `.ply` or `.sog` capture to view this digital twin.");
        updateLoadState("error");
        return;
      }

      clearCurrentScene();
      setErrorMessage(null);
      publishStats({
        assetName: file.name,
        splatCount: null,
        fps: statsRef.current.fps,
      });
      updateLoadState("loading");

      const blobUrl = URL.createObjectURL(file);
      blobUrlRef.current = blobUrl;

      try {
        const asset = await new Promise<PlayCanvas.Asset>((resolve, reject) => {
          app.assets.loadFromUrlAndFilename(
            blobUrl,
            file.name,
            "gsplat",
            (err, loadedAsset) => {
              if (err || !loadedAsset) {
                reject(new Error(err ?? "The capture could not be loaded."));
                return;
              }

              resolve(loadedAsset);
            },
          );
        });

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
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "The capture failed to load. Try a different file.",
        );
        publishStats({
          assetName: "Awaiting capture",
          splatCount: null,
        });
        updateLoadState("error");
      }
    }

    function handleDrop(event: DragEvent<HTMLDivElement>) {
      event.preventDefault();
      setIsDragActive(false);

      const droppedFile = event.dataTransfer.files[0];
      if (!droppedFile) return;

      void loadFile(droppedFile);
    }

    function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
      const selectedFile = event.target.files?.[0];
      event.target.value = "";

      if (!selectedFile) return;

      void loadFile(selectedFile);
    }

    useImperativeHandle(
      ref,
      () => ({
        focusPreset(id) {
          applyPreset(id);
        },
        openFilePicker() {
          inputRef.current?.click();
        },
      }),
      [],
    );

    useEffect(() => {
      let isMounted = true;
      let destroyListeners: Array<() => void> = [];

      async function initialize() {
        const canvas = canvasRef.current;
        const viewport = viewportRef.current;

        if (!canvas || !viewport) return;

        try {
          const pc = await import("playcanvas");
          if (!isMounted) return;

          pcRef.current = pc;

          const graphicsDevice = await pc.createGraphicsDevice(canvas, {
            deviceTypes: [pc.DEVICETYPE_WEBGPU, pc.DEVICETYPE_WEBGL2],
            antialias: false,
          });

          if (!isMounted) {
            graphicsDevice.destroy();
            return;
          }

          graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio, 2);

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
          app.scene.gsplat.renderer = pc.GSPLAT_RENDERER_AUTO;
          app.scene.gsplat.minPixelSize = 2;
          app.scene.gsplat.minContribution = 2;
          app.scene.ambientLight = new pc.Color(0.12, 0.12, 0.11);

          const camera = new pc.Entity("viewer-camera");
          camera.addComponent("camera", {
            clearColor: new pc.Color(0.035, 0.036, 0.04),
            fov: 58,
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
            if (!viewportRef.current || !appRef.current) return;

            const width = viewportRef.current.clientWidth;
            const height = viewportRef.current.clientHeight;

            if (width <= 0 || height <= 0) return;

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
            desiredPositionRef.current = sphericalToCartesian(
              orbitRef.current.yaw,
              orbitRef.current.pitch,
              orbitRef.current.distance,
              currentTargetRef.current,
            );
            desiredTargetRef.current = copyVector(currentTargetRef.current);
            animationActiveRef.current = true;
          };

          const handlePointerDown = (event: PointerEvent) => {
            interactionRef.current.isDragging = true;
            interactionRef.current.pointerX = event.clientX;
            interactionRef.current.pointerY = event.clientY;
            canvas.setPointerCapture(event.pointerId);
          };

          const handlePointerMove = (event: PointerEvent) => {
            if (!interactionRef.current.isDragging || !sceneReadyRef.current) return;

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
            if (!sceneReadyRef.current) return;

            event.preventDefault();
            orbitRef.current.distance = clamp(
              orbitRef.current.distance * (event.deltaY > 0 ? 1.08 : 0.92),
              0.8,
              120,
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

          app.on("update", () => {
            desiredPosition.set(...desiredPositionRef.current);
            desiredTarget.set(...desiredTargetRef.current);

            if (animationActiveRef.current) {
              currentPosition.lerp(currentPosition, desiredPosition, 0.12);
              currentTarget.lerp(currentTarget, desiredTarget, 0.12);

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
                syncOrbitFromPose();
              }
            }

            commitCameraPose();
          });

          app.start();
          resizeCanvas();
          commitCameraPose();

          fpsIntervalRef.current = window.setInterval(() => {
            if (!appRef.current) return;

            const fps = Math.round(appRef.current.stats.frame.fps || 0);
            publishStats({ fps });
          }, 500);

          publishStats({
            backend:
              graphicsDevice.deviceType === pc.DEVICETYPE_WEBGPU
                ? "WebGPU"
                : "WebGL2",
          });
          updateLoadState("idle");
        } catch (error) {
          if (!isMounted) return;

          setErrorMessage(
            error instanceof Error
              ? error.message
              : "The PlayCanvas viewer could not be initialized.",
          );
          publishStats({
            backend: "Unavailable",
            assetName: "Viewer unavailable",
            splatCount: null,
            fps: null,
          });
          updateLoadState("error");
        }
      }

      void initialize();

      return () => {
        isMounted = false;

        destroyListeners.forEach((destroyListener) => destroyListener());
        resizeObserverRef.current?.disconnect();
        resizeObserverRef.current = null;

        if (fpsIntervalRef.current !== null) {
          window.clearInterval(fpsIntervalRef.current);
          fpsIntervalRef.current = null;
        }

        clearCurrentScene();
        appRef.current?.destroy();
        appRef.current = null;
        cameraRef.current = null;
      };
    }, [publishStats, updateLoadState]);

    const progress = progressByState[loadState];
    const hasLoadedAsset = statsRef.current.status === "Ready";

    return (
      <div
        ref={viewportRef}
        className={`relative h-full min-h-[32rem] overflow-hidden rounded-[2rem] border border-white/10 bg-[#050608] ${
          isDragActive ? "ring-2 ring-[#3b82f6]/70 ring-offset-0" : ""
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragActive(true);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setIsDragActive(false);
        }}
        onDrop={handleDrop}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        <input
          ref={inputRef}
          type="file"
          accept=".ply,.sog"
          className="hidden"
          onChange={handleInputChange}
        />

        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(79,120,188,0.14),transparent_34%),linear-gradient(180deg,rgba(7,8,10,0.08),rgba(7,8,10,0.35))]" />

        <div className="pointer-events-none absolute left-6 top-6 flex flex-wrap gap-3">
          <div className="rounded-full border border-white/10 bg-black/35 px-4 py-2 text-[0.7rem] uppercase tracking-[0.34em] text-white/60 backdrop-blur-xl">
            Full-scene capture review
          </div>
          <div className="rounded-full border border-white/10 bg-black/35 px-4 py-2 text-[0.75rem] text-white/70 backdrop-blur-xl">
            {statsRef.current.backend}
          </div>
        </div>

        <div className="pointer-events-none absolute bottom-6 left-6 max-w-sm rounded-[1.4rem] border border-white/10 bg-black/35 px-5 py-4 backdrop-blur-xl">
          <p className="text-[0.68rem] uppercase tracking-[0.32em] text-white/45">
            Spatial controls
          </p>
          <p className="mt-2 text-sm text-white/76">
            Orbit with drag, zoom with scroll, and use the panel presets to jump between composed viewpoints.
          </p>
        </div>

        {!hasLoadedAsset && loadState !== "loading" && loadState !== "framing" ? (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="max-w-xl rounded-[2rem] border border-white/12 bg-[linear-gradient(180deg,rgba(20,24,31,0.9),rgba(10,11,14,0.78))] px-8 py-10 text-center shadow-[0_40px_120px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
              <p className="text-[0.72rem] uppercase tracking-[0.38em] text-[#7aa6ff]">
                Drag-and-drop viewer
              </p>
              <h2 className="mt-4 font-[family-name:var(--font-display)] text-4xl leading-none text-white sm:text-5xl">
                Load a Gaussian splat and inspect the twin in-browser.
              </h2>
              <p className="mt-5 text-base leading-7 text-white/68">
                Drop a `.ply` or `.sog` capture into the viewport, or choose a file to start a local review session.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <button
                  type="button"
                  className="pointer-events-auto rounded-full border border-[#3b82f6]/45 bg-[#3b82f6]/18 px-6 py-3 text-sm font-medium text-white transition hover:bg-[#3b82f6]/28"
                  onClick={() => inputRef.current?.click()}
                >
                  Choose capture
                </button>
                <div className="rounded-full border border-white/10 px-5 py-3 text-sm text-white/54">
                  Supports PlayCanvas `.sog` and raw `.ply` files
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {loadState === "loading" || loadState === "framing" ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[linear-gradient(180deg,rgba(4,5,7,0.74),rgba(4,5,7,0.88))] p-6 backdrop-blur-md">
            <div className="w-full max-w-lg rounded-[1.8rem] border border-white/10 bg-black/45 px-7 py-8 shadow-[0_30px_90px_rgba(0,0,0,0.4)]">
              <p className="text-[0.7rem] uppercase tracking-[0.34em] text-[#7aa6ff]">
                Reconstructing Spatial Data...
              </p>
              <p className="mt-3 text-sm leading-7 text-white/68">
                {loadState === "loading"
                  ? "Streaming splat buffers into the viewer runtime."
                  : "Fitting the camera envelope and calibrating review presets."}
              </p>
              <div className="mt-6 h-2 rounded-full bg-white/8">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#3b82f6,#78a6ff)] transition-[width] duration-500 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>
        ) : null}

        {errorMessage ? (
          <div className="absolute right-6 top-24 max-w-md rounded-[1.4rem] border border-[#bb5f66]/35 bg-[rgba(70,18,24,0.76)] px-5 py-4 text-sm leading-6 text-white shadow-[0_20px_60px_rgba(0,0,0,0.3)] backdrop-blur-xl">
            <p className="text-[0.68rem] uppercase tracking-[0.34em] text-[#f0a0a9]">
              Loading issue
            </p>
            <p className="mt-2 text-white/86">{errorMessage}</p>
          </div>
        ) : null}
      </div>
    );
  },
);
