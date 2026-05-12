import type { ViewPreset } from "@/types/spatial";

export const demoRoomPresets: ViewPreset[] = [
  {
    id: "entryway",
    label: "Entryway",
    description:
      "Arrival threshold study for first-look orientation and circulation.",
    position: [0.2, 1.65, 8.6],
    previewImageSrc: "/assets/viewpoints/entryway-preview.svg",
    previewAlt: "Entryway preview thumbnail",
    previewCaption: "Arrival threshold and primary circulation view.",
    rotationEuler: [0, 180, 0],
    focusDistance: 6.2,
    durationMs: 1200,
  },
  {
    id: "kitchen",
    label: "Kitchen",
    description:
      "Oblique kitchen framing for materials, proportion, and adjacency review.",
    position: [5.1, 2.3, 4.6],
    previewImageSrc: "/assets/viewpoints/kitchen-preview.svg",
    previewAlt: "Kitchen preview thumbnail",
    previewCaption: "Island, worktop, and adjacency study.",
    rotationEuler: [-4, -138, 0],
    focusDistance: 5.8,
    durationMs: 1325,
  },
  {
    id: "lounge",
    label: "Lounge",
    description:
      "Closer lounge composition for seating, depth, and focal balance.",
    position: [-4.4, 1.95, 3.8],
    previewImageSrc: "/assets/viewpoints/lounge-preview.svg",
    previewAlt: "Lounge preview thumbnail",
    previewCaption: "Seating zone and focal depth composition.",
    rotationEuler: [-2, 128, 0],
    focusDistance: 5.4,
    durationMs: 1425,
  },
];

export const viewerDiagnostics = {
  enabledByDefault: false,
  shortcutKey: "d",
} as const;
