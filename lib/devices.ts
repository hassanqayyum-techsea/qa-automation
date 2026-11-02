// Playwright's device list, shaped for the device picker and the runner. Server only (imports playwright).
import { devices, type BrowserContextOptions } from "playwright";
import { customSize, frameShape } from "./testdsl";

export type DeviceKind = "phone" | "tablet" | "desktop";
export type DeviceInfo = { name: string; kind: DeviceKind; width: number; height: number; mobile: boolean };

// Mobile profiles use the full screen (no browser toolbars) so frames match the phone mockup.
// `screen` exists at runtime on descriptors but isn't in the DeviceDescriptor type.
const sizeOf = (d: (typeof devices)[string]) =>
  (d.isMobile && (d as { screen?: { width: number; height: number } }).screen) || d.viewport;

const KIND_ORDER: DeviceKind[] = ["phone", "tablet", "desktop"];

/** Every Playwright device except the landscape duplicates (a custom size covers those). */
export const DEVICE_LIST: DeviceInfo[] = Object.entries(devices)
  .filter(([name]) => !name.endsWith(" landscape"))
  .map(([name, d]) => {
    const { width, height } = sizeOf(d);
    const kind: DeviceKind = !d.isMobile ? "desktop" : Math.min(width, height) >= 600 ? "tablet" : "phone";
    return { name, kind, width, height, mobile: d.isMobile };
  })
  .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name));

export const DEVICE_NAMES = Object.keys(devices);

/** Browser context options for a parsed `device:` value (a Playwright name or a custom size). */
export function contextFor(device: string): { options: BrowserContextOptions; width: number; height: number; mobile: boolean } {
  const size = customSize(device);
  if (size) {
    const { width, height, mobile } = size;
    return {
      options: { viewport: { width, height }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1 },
      width,
      height,
      mobile,
    };
  }
  const d = devices[device];
  const { width, height } = sizeOf(d);
  return { options: { ...d, viewport: { width, height } }, width, height, mobile: d.isMobile };
}

export const shapeOf = (device: string) => {
  const c = customSize(device) ?? (devices[device] ? contextFor(device) : null);
  return c ? frameShape(c.width, c.height, c.mobile) : "phone";
};
