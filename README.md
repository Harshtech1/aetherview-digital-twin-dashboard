# AetherView

AetherView is a premium browser-based dashboard for reviewing 3D Gaussian splat captures. It uses Next.js for the application shell and PlayCanvas for real-time rendering, with a WebGPU-first pipeline and WebGL2 fallback for broader device support.

## What it does

- Loads local `.ply` and `.sog` captures entirely in the browser
- Uses PlayCanvas GSplat rendering with WebGPU priority
- Falls back to WebGL2 when WebGPU is unavailable
- Frames each loaded scene automatically from its computed bounds
- Generates reusable `Front`, `Angle`, and `Focus` viewpoints per capture
- Surfaces live viewer stats such as backend, splat count, FPS, and load state
- Provides a branded, responsive review shell instead of a raw engine demo

## Tech stack

- Next.js 14
- React 18
- TypeScript
- Tailwind CSS
- PlayCanvas `2.19.0-preview.0`

## Project structure

```text
app/
  globals.css
  layout.tsx
  page.tsx
components/
  digital-twin-dashboard.tsx
  gsplat-viewer.tsx
public/
  assets/
```

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Team setup: Git LFS

This repository tracks large spatial assets such as `.ply`, `.sog`, and `.splat`
with Git LFS. Before working with scene files, run:

```bash
git lfs install
git lfs pull
```

Without Git LFS, large assets may be checked out as pointer files instead of the
real capture data.

## Supported capture formats

- `.ply`
- `.sog`

Drop a supported file into the viewport or use **Choose capture file** from the control panel.

## Optional preprocessing

If a raw `.ply` capture is too heavy for quick browser review, compress it first:

```bash
npx @playcanvas/splat-transform input-house-scan.ply output-house-scan.sog --compress
```

Then load `output-house-scan.sog` into the viewer.

## Local smoke-test asset

You can validate the viewer locally with the sample capture already present in the workspace:

```text
..\engine\examples\assets\splats\skull.sog
```

## Production build

```bash
npm run build
```

## Scope

This repository is focused on the review experience, not the full reconstruction pipeline.

Out of scope for v1:

- training or capture generation
- cloud GPU workflows
- scene authoring or annotation persistence
- deployment automation beyond standard hosting
