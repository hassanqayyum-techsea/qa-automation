"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { parseDate } from "@internationalized/date";
import { ButtonGroup, ButtonGroupItem } from "@your-job-search-genius/odyssey-ui/components/base/button-group/button-group";
import { DateRangePicker } from "@your-job-search-genius/odyssey-ui/components/application/date-picker/date-range-picker";

const PRESETS = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
  { id: "1y", label: "12 months" },
];

/** Time-period picker. State lives in the URL (?range= or ?from=&to=) so pages are linkable and refresh-safe. */
export function RangeControl({ rangeKey, from, to }: { rangeKey: string; from: string; to: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const go = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    router.push(`${pathname}?${p}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <ButtonGroup
        size="sm"
        aria-label="Time period"
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={rangeKey === "custom" ? [] : [rangeKey]}
        onSelectionChange={(keys) => {
          const k = [...keys][0];
          if (k) go({ range: String(k), from: null, to: null });
        }}
      >
        {PRESETS.map((p) => (
          <ButtonGroupItem key={p.id} id={p.id}>
            {p.label}
          </ButtonGroupItem>
        ))}
      </ButtonGroup>
      <DateRangePicker
        aria-label="Custom date range"
        value={{ start: parseDate(from), end: parseDate(to) }}
        onChange={(v) => v && go({ from: v.start.toString(), to: v.end.toString(), range: null })}
      />
    </div>
  );
}
