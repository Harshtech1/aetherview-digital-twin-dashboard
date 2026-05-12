import { DigitalTwinDashboard } from "@/components/digital-twin-dashboard";
import { demoRoomPresets, viewerDiagnostics } from "@/data/spatial-demo";

export default function ViewerPage(): JSX.Element {
  return (
    <DigitalTwinDashboard
      assetUrl="/assets/property-scan.ply"
      assetName="property-scan.ply"
      roomPresets={demoRoomPresets}
      initialPresetId="entryway"
      diagnostics={viewerDiagnostics}
      derivePresetGeometry
    />
  );
}
