"use client";

import { useState } from "react";
import { ButtonGroup, ButtonGroupItem } from "@your-job-search-genius/odyssey-ui/components/base/button-group/button-group";
import { Select } from "@your-job-search-genius/odyssey-ui/components/base/select/select";
import { Input } from "@your-job-search-genius/odyssey-ui/components/base/input/input";
import { Checkbox } from "@your-job-search-genius/odyssey-ui/components/base/checkbox/checkbox";
import { Button } from "@your-job-search-genius/odyssey-ui/components/base/buttons/button";
import { customSize } from "~/lib/testdsl";
import type { DeviceInfo, DeviceKind } from "~/lib/devices";

type Kind = DeviceKind | "custom";
const KINDS: { id: Kind; label: string; first: string | null }[] = [
  { id: "phone", label: "Phone", first: "iPhone 15" },
  { id: "tablet", label: "Tablet", first: "iPad Pro 11" },
  { id: "desktop", label: "Desktop", first: "Desktop Chrome" },
  { id: "custom", label: "Custom size", first: null },
];
const NO_SESSION = "__none__";

/** The test's device and the sign-in test that runs before it. Both are settings saved with the test, not Markdown. */
export function RunSetup({
  devices,
  tests,
  device,
  session,
  isDisabled,
  onDevice,
  onSession,
}: {
  devices: DeviceInfo[];
  tests: { id: string; name: string }[];
  device: string;
  /** Id of the test that signs in first, or null. */
  session: string | null;
  isDisabled: boolean;
  onDevice: (device: string) => void;
  onSession: (test: string | null) => void;
}) {
  const size = customSize(device);
  const current = devices.find((d) => d.name === device);
  const [customOpen, setCustomOpen] = useState(false);
  const kind: Kind = customOpen || size ? "custom" : (current?.kind ?? "phone");
  const [width, setWidth] = useState(String(size?.width ?? current?.width ?? 1366));
  const [height, setHeight] = useState(String(size?.height ?? current?.height ?? 768));
  const [mobile, setMobile] = useState(size?.mobile ?? false);
  const typed = customSize(`${width}x${height}${mobile ? " mobile" : ""}`);

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-secondary p-4">
      <div className="flex flex-col gap-2">
        <span id="device-kind" className="text-sm font-medium text-secondary">Device</span>
        <ButtonGroup
          size="sm"
          aria-labelledby="device-kind"
          selectionMode="single"
          disallowEmptySelection
          isDisabled={isDisabled}
          selectedKeys={[kind]}
          onSelectionChange={(keys) => {
            const k = KINDS.find((x) => x.id === [...keys][0]);
            if (!k) return;
            setCustomOpen(k.id === "custom");
            if (k.first) onDevice(k.first);
          }}
        >
          {KINDS.map((k) => (
            <ButtonGroupItem key={k.id} id={k.id}>
              {k.label}
            </ButtonGroupItem>
          ))}
        </ButtonGroup>
      </div>

      {kind === "custom" ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Width (px)" type="number" inputMode="numeric" value={width} onChange={setWidth} isDisabled={isDisabled} />
            <Input label="Height (px)" type="number" inputMode="numeric" value={height} onChange={setHeight} isDisabled={isDisabled} />
          </div>
          <Checkbox label="Touch phone" hint="Mobile browser with a touchscreen. Leave off for a desktop window." isSelected={mobile} onChange={setMobile} isDisabled={isDisabled} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-tertiary">{typed ? `Uses device: ${width}x${height}${mobile ? " mobile" : ""}` : "Width and height must be between 240 and 3840 px."}</span>
            <Button color="secondary" size="sm" isDisabled={isDisabled || !typed} onClick={() => typed && onDevice(`${typed.width}x${typed.height}${typed.mobile ? " mobile" : ""}`)}>
              Use this size
            </Button>
          </div>
        </div>
      ) : (
        <Select.ComboBox
          label={KINDS.find((k) => k.id === kind)!.label}
          placeholder="Search devices"
          items={devices.filter((d) => d.kind === kind).map((d) => ({ id: d.name, label: d.name, supportingText: `${d.width}×${d.height}` }))}
          selectedKey={current ? device : null}
          onSelectionChange={(key) => key && onDevice(String(key))}
          isDisabled={isDisabled}
        >
          {(item) => <Select.Item id={item.id} label={item.label} supportingText={item.supportingText} />}
        </Select.ComboBox>
      )}

      <Select
        label="Start signed in with"
        hint={tests.length ? "Runs that test first in the same browser, so this test starts with its session." : "Create a sign-in test in this app first, then pick it here."}
        items={[{ id: NO_SESSION, label: "No session (start signed out)" }, ...tests.map((t) => ({ id: t.id, label: t.name }))]}
        selectedKey={session ?? NO_SESSION}
        onSelectionChange={(key) => onSession(key === NO_SESSION || key === null ? null : String(key))}
        isDisabled={isDisabled}
      >
        {(item) => <Select.Item id={item.id} label={item.label} />}
      </Select>
    </div>
  );
}
