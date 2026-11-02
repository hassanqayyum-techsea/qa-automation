"use client";

import { memo } from "react";
import { IPhoneMockup } from "@your-job-search-genius/odyssey-ui/components/shared-assets/iphone-mockup";
import { cx } from "@your-job-search-genius/odyssey-ui/utils/cx";
import type { FrameShape } from "~/lib/testdsl";

// 1×1 white pixel so the screen isn't empty before the first frame.
const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";

/** A browser screenshot or live frame. Phone shapes sit in the phone mockup; tablets and desktops in a plain frame. */
export const DeviceScreen = memo(function DeviceScreen({
  jpeg,
  shape,
  label,
  size = "lg",
}: {
  jpeg: string | null;
  shape: FrameShape;
  label: string;
  size?: "sm" | "lg";
}) {
  const src = jpeg ? `data:image/jpeg;base64,${jpeg}` : BLANK;
  if (shape === "phone") {
    return (
      <div role="img" aria-label={label} className="flex justify-center">
        <IPhoneMockup image={src} className={cx("w-full", size === "lg" ? "max-w-xs" : "max-w-60")} aria-hidden="true" />
      </div>
    );
  }
  return (
    <div className={cx("flex justify-center", shape === "portrait" && (size === "lg" ? "mx-auto w-full max-w-md" : "mx-auto w-full max-w-60"))}>
      {/* CODE-09 deviation from the forbidden-<img> rule: Odyssey has no image component and IPhoneMockup only fits
          phone-shaped screens, so tablet and desktop frames need a plain image. Tracked as a library gap. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- base64 frames from the runner; next/image can't optimise them */}
      <img src={src} alt={label} className={cx("h-auto w-full rounded-lg border border-secondary bg-primary", !jpeg && "aspect-video")} />
    </div>
  );
});
