"use client";

import { Alert } from "@your-job-search-genius/odyssey-ui/components/application/alerts/alert";
import { DescriptionList } from "@your-job-search-genius/odyssey-ui/components/base/description-list/description-list";
import { Heading } from "@your-job-search-genius/odyssey-ui/components/base/typography/heading";
import { Body2 } from "@your-job-search-genius/odyssey-ui/components/base/typography/body-2";
import type { StepResult } from "~/lib/db";
import type { FrameShape } from "~/lib/testdsl";
import { DeviceScreen } from "../../apps/device-screen";

const MARK = { pending: "Not run", running: "Interrupted", passed: "Passed", failed: "Failed", skipped: "Skipped" } as const;

// Client component because compound parts like DescriptionList.Item aren't reachable from Server Components.
export function RunView({
  error,
  stopped,
  app,
  duration,
  values,
  steps,
  shape,
}: {
  error: string | null;
  stopped: boolean;
  app: string;
  duration: string;
  values: Record<string, number>;
  steps: StepResult[];
  shape: FrameShape;
}) {
  return (
    <>
      {error && <Alert color={stopped ? "warning" : "error"} autoFocus={false} title="Why it stopped" description={error} />}
      <DescriptionList layout="inline" isDivided columns={2}>
        <DescriptionList.Item term="App">{app}</DescriptionList.Item>
        <DescriptionList.Item term="Duration">{duration}</DescriptionList.Item>
        {Object.entries(values).map(([k, v]) => (
          <DescriptionList.Item key={k} term={`Counted: ${k}`}>{v.toLocaleString()}</DescriptionList.Item>
        ))}
      </DescriptionList>
      <section aria-labelledby="steps-heading" className="flex flex-col gap-6">
        <Heading level={2} size={5} id="steps-heading">Steps</Heading>
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 xl:grid-cols-3">
          {steps.map((s, i) => (
            <article key={i} className="flex min-w-0 flex-col gap-3" aria-labelledby={`step-${i}`}>
              <div className="flex flex-col gap-1">
                <Heading level={3} size={6} id={`step-${i}`} className="font-mono wrap-anywhere">{`${i + 1}. ${s.text}`}</Heading>
                <Body2>{`${MARK[s.status]}${s.ms !== undefined ? ` in ${(s.ms / 1000).toFixed(1)}s` : ""}${s.note ? ` · ${s.note}` : ""}`}</Body2>
              </div>
              {s.screenshot ? (
                <DeviceScreen jpeg={s.screenshot} shape={shape} size="sm" label={`Screen after step ${i + 1}`} />
              ) : (
                <Body2>No screenshot for this step.</Body2>
              )}
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
