export type Vector3Tuple = [number, number, number];

export type RenderQualityMode =
  | "Cinematic"
  | "Balanced"
  | "Compatibility";

export type ViewerLoadState =
  | "idle"
  | "loading"
  | "framing"
  | "ready"
  | "error";

export type ViewerDisplayStatus = "Idle" | "Loading" | "Ready" | "Error";

export interface ViewPreset {
  id: string;
  label: string;
  description: string;
  position: Vector3Tuple;
  previewImageSrc: string;
  previewAlt?: string;
  previewCaption?: string;
  target?: Vector3Tuple;
  rotationEuler?: Vector3Tuple;
  focusDistance?: number;
  durationMs?: number;
}

export interface DiagnosticsConfig {
  enabledByDefault?: boolean;
  shortcutKey?: string;
}

export interface ViewerStats {
  backend: string;
  assetName: string;
  splatCount: number | null;
  fps: number | null;
  gpuMemoryBytes: number | null;
  renderQuality: RenderQualityMode;
  diagnosticsVisible: boolean;
  fallbackMode: boolean;
  status: ViewerLoadState;
}
