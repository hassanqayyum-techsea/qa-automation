"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TextArea } from "@your-job-search-genius/odyssey-ui/components/base/textarea/textarea";
import { Button } from "@your-job-search-genius/odyssey-ui/components/base/buttons/button";
import { Alert, toast } from "@your-job-search-genius/odyssey-ui/components/application/alerts/alert";
import { Table, TableCard } from "@your-job-search-genius/odyssey-ui/components/application/table/table";
import { DescriptionList } from "@your-job-search-genius/odyssey-ui/components/base/description-list/description-list";
import { Tabs } from "@your-job-search-genius/odyssey-ui/components/application/tabs/tabs";
import { Heading } from "@your-job-search-genius/odyssey-ui/components/base/typography/heading";
import { Body2 } from "@your-job-search-genius/odyssey-ui/components/base/typography/body-2";
import { Play, Stop } from "@your-job-search-genius/odyssey-ui/components/foundations/icons";
import { customSize, frameShape, parseTest, resolveDevice, splitHeader, STEP_HELP } from "~/lib/testdsl";
import type { DeviceInfo } from "~/lib/devices";
import { DeviceScreen } from "../../../device-screen";
import { RunSetup } from "./run-setup";
import { TestPreview } from "./test-preview";
import type { StepResult } from "~/lib/db";
import { generateSteps, saveTest, startRun, stopRun, type TestDraft } from "../../../actions";
import { RUN, RunBadge, StepBadge, type RunState } from "../../../app-ui";

type Version = TestDraft & { id: string; at: string; by: string; source: "saved" | "draft" | "ai"; prompt: string | null; sessionName: string | null };
type History = { id: string; status: RunState; by: string; createdAt: string; ms: number | null; passed: number; total: number };
type LiveMsg =
  | { t: "snapshot"; status: RunState; steps: StepResult[]; values: Record<string, number>; error: string | null }
  | { t: "frame"; d: string }
  | { t: "step"; i: number; step: StepResult }
  | { t: "status"; status: RunState; error?: string; values?: Record<string, number> };

const isLive = (s: RunState | null) => s === "queued" || s === "running";
const sameDraft = (a: TestDraft, b: TestDraft) => a.markdown === b.markdown && a.device === b.device && a.sessionTestId === b.sessionTestId;
const SOURCE = { saved: "Saved", draft: "Before AI edit", ai: "AI edit" } as const;

export function Workbench({
  testId,
  initial,
  canEdit,
  canRun,
  runBlockedReason,
  activeRunId,
  history,
  aiEnabled,
  devices,
  tests,
  versions,
}: {
  testId: string;
  initial: TestDraft;
  canEdit: boolean;
  canRun: boolean;
  runBlockedReason: string | null;
  activeRunId: string | null;
  history: History[];
  aiEnabled: boolean;
  devices: DeviceInfo[];
  /** Other tests in this app, which can provide the session. */
  tests: { id: string; name: string }[];
  /** Newest first. */
  versions: Version[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const edit = (patch: Partial<TestDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [saving, startSave] = useTransition();
  const [starting, startStart] = useTransition();
  const [stopping, startStop] = useTransition();
  const deviceNames = useMemo(() => devices.map((d) => d.name), [devices]);
  const parsed = useMemo(() => parseTest(draft.markdown), [draft.markdown]);
  const screen = customSize(draft.device) ?? devices.find((d) => d.name === draft.device);
  const shape = screen ? frameShape(screen.width, screen.height, screen.mobile) : "phone";
  const sessionName = tests.find((t) => t.id === draft.sessionTestId)?.name ?? null;
  const [prompt, setPrompt] = useState("");
  const [generating, startGenerate] = useTransition();

  const generate = () =>
    startGenerate(async () => {
      const res = await generateSteps(testId, prompt, draft);
      if (res.error) return void toast.error(res.error);
      setDraft({ markdown: res.markdown!, device: res.device!, sessionTestId: res.sessionTestId ?? null });
      setTab("write");
      if (res.warning) toast.warning(res.warning);
      else toast.success("Test updated. Check it, then Save or Run. The earlier version is under Versions.");
    });
  const dirty = !sameDraft(draft, saved);

  const [runId, setRunId] = useState<string | null>(activeRunId);
  const [status, setStatus] = useState<RunState | null>(null);
  const [steps, setSteps] = useState<StepResult[]>([]);
  const [values, setValues] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  // Follow the current run over SSE: snapshot first, then frames, step updates and the final status.
  useEffect(() => {
    if (!runId) return;
    const es = new EventSource(`/api/runs/${runId}/stream`);
    es.onmessage = (ev) => {
      const m = JSON.parse(ev.data) as LiveMsg;
      if (m.t === "frame") return setFrame(m.d);
      if (m.t === "snapshot") {
        setStatus(m.status);
        setSteps(m.steps);
        setValues(m.values);
        setError(m.error);
        if (!isLive(m.status)) es.close(); // already finished; the server ends the stream, so don't reconnect
      } else if (m.t === "step") {
        setSteps((prev) => prev.map((s, i) => (i === m.i ? m.step : s)));
        if (m.step.status !== "running") setAnnouncement(`Step ${m.i + 1} ${m.step.status}: ${m.step.text}`);
      } else if (m.t === "status") {
        setStatus(m.status);
        if (m.values) setValues(m.values);
        setError(m.error ?? null);
        if (!isLive(m.status)) {
          setAnnouncement(`Run ${RUN[m.status].label.toLowerCase()}.${m.error ? ` ${m.error}` : ""}`);
          es.close();
          router.refresh(); // pull the finished run into the history table
        }
      }
    };
    return () => es.close();
  }, [runId, router]);

  const save = () =>
    new Promise<boolean>((resolve) =>
      startSave(async () => {
        // `device:` / `session:` lines typed into the Markdown move into the settings on save.
        const h = splitHeader(draft.markdown);
        const next: TestDraft =
          h.device || h.session
            ? {
                markdown: h.body,
                device: (h.device && resolveDevice(h.device, deviceNames)) || draft.device,
                sessionTestId: (h.session && tests.find((t) => t.name.toLowerCase() === h.session!.toLowerCase())?.id) || draft.sessionTestId,
              }
            : draft;
        const res = await saveTest(testId, next);
        if (res?.error) {
          toast.error(res.error);
          return resolve(false);
        }
        setDraft(next);
        setSaved(next);
        resolve(true);
      }),
    );

  const run = () =>
    startStart(async () => {
      if (dirty && !(await save())) return;
      const res = await startRun(testId);
      if (res.error) return void toast.error(res.error);
      setFrame(null);
      setValues({});
      setError(null);
      setSteps(parsed.steps.map((s) => ({ text: s.text, status: "pending" })));
      setStatus("queued");
      setRunId(res.runId!);
    });

  const live = isLive(status);
  const passed = steps.filter((s) => s.status === "passed").length;

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
        <section aria-labelledby="editor-heading" className="flex min-w-0 flex-col gap-4">
          <Heading level={2} size={5} id="editor-heading">Steps</Heading>
          {canEdit && aiEnabled && (
            <div className="flex flex-col gap-3 rounded-xl border border-secondary p-4">
              <TextArea
                label="Generate with AI"
                value={prompt}
                onChange={setPrompt}
                rows={3}
                placeholder="Log in with the test account, enter OTP 000000, open Jobs and check at least one job card shows"
                hint="Describe the test, or what to change in the current one. Nothing is saved until you press Save or Run, and every AI edit is kept under Versions."
              />
              <div className="flex flex-wrap justify-end gap-3">
                <Button color="secondary" size="md" onClick={generate} isLoading={generating} showTextWhileLoading isDisabled={prompt.trim().length < 10}>
                  {generating ? "Generating…" : parsed.steps.length ? "Update test with AI" : "Generate steps"}
                </Button>
              </div>
            </div>
          )}
          <RunSetup
            devices={devices}
            tests={tests}
            device={draft.device}
            session={draft.sessionTestId}
            isDisabled={!canEdit}
            onDevice={(device) => edit({ device })}
            onSession={(sessionTestId) => edit({ sessionTestId })}
          />
          <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(k as "write" | "preview")}>
            <Tabs.List
              type="underline"
              aria-label="Test Markdown"
              items={[
                { id: "write", label: "Write" },
                { id: "preview", label: "Preview" },
              ]}
            />
            <Tabs.Panel id="write" className="pt-4">
              <TextArea
                label="Test (Markdown)"
                value={draft.markdown}
                onChange={(markdown) => edit({ markdown })}
                isReadOnly={!canEdit}
                rows={18}
                textAreaClassName="font-mono text-sm"
                hint={dirty ? "Unsaved changes. Run saves them first." : "Saved."}
              />
            </Tabs.Panel>
            <Tabs.Panel id="preview" className="pt-4">
              {tab === "preview" && <TestPreview markdown={draft.markdown} parsed={parsed} />}
            </Tabs.Panel>
          </Tabs>
          {parsed.errors.length > 0 ? (
            <Alert
              color="error"
              autoFocus={false}
              title={`${parsed.errors.length} line(s) can't run yet`}
              description={parsed.errors.map((e) => e.message).join(" ")}
            />
          ) : (
            <Body2>{`${parsed.steps.length} steps on ${draft.device}${sessionName ? `, after signing in with "${sessionName}"` : ""}.`}</Body2>
          )}
          <div className="flex flex-wrap justify-end gap-3">
            {canEdit && (
              <Button color="secondary" size="md" onClick={() => void save()} isDisabled={!dirty} isLoading={saving} showTextWhileLoading>
                Save
              </Button>
            )}
            {live ? (
              <Button
                color="secondary-destructive"
                size="md"
                iconLeading={Stop}
                isLoading={stopping}
                showTextWhileLoading
                onClick={() =>
                  startStop(async () => {
                    const r = await stopRun(runId!);
                    if (r?.error) toast.error(r.error);
                  })
                }
              >
                Stop run
              </Button>
            ) : (
              <Button
                size="md"
                iconLeading={Play}
                onClick={run}
                isLoading={starting}
                showTextWhileLoading
                isDisabled={!canRun || parsed.errors.length > 0}
              >
                Run test
              </Button>
            )}
          </div>
          {!canRun && runBlockedReason && <Body2>{runBlockedReason}</Body2>}
          <DescriptionList layout="stacked">
            <DescriptionList.Item term="Steps you can write">
              <span className="flex flex-col gap-1 font-mono text-sm">
                {STEP_HELP.map((h) => (
                  <span key={h}>{`- ${h}`}</span>
                ))}
              </span>
            </DescriptionList.Item>
          </DescriptionList>
        </section>

        <section aria-labelledby="live-heading" className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Heading level={2} size={5} id="live-heading">Live run</Heading>
            {status && <RunBadge status={status} />}
          </div>
          {/* Screen-reader progress: step results and the final outcome, politely. */}
          <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
          <DeviceScreen
            jpeg={frame}
            shape={shape}
            label={status ? `Live screen of the test browser, ${RUN[status].label.toLowerCase()}` : "Test browser screen. Press Run test to start."}
          />
          {!status && <Body2 className="text-center">Press Run test to watch it here, step by step.</Body2>}
          {error && <Alert color="error" autoFocus={false} title="The run didn't pass" description={error} />}
          {Object.keys(values).length > 0 && (
            <DescriptionList layout="inline" isDivided>
              {Object.entries(values).map(([k, v]) => (
                <DescriptionList.Item key={k} term={k}>{v.toLocaleString()}</DescriptionList.Item>
              ))}
            </DescriptionList>
          )}
          {steps.length > 0 && (
            <TableCard.Root>
              <TableCard.Header title="Progress" description={`${passed} of ${steps.length} steps passed`} />
              <div className="overflow-x-auto">
                <Table aria-label="Run progress" size="sm">
                  <Table.Header>
                    <Table.Head id="n" label="#" />
                    <Table.Head id="step" label="Step" isRowHeader />
                    <Table.Head id="status" label="Result" />
                  </Table.Header>
                  <Table.Body items={steps.map((s, i) => ({ ...s, id: i }))} dependencies={[steps]}>
                    {(s) => (
                      <Table.Row id={s.id}>
                        <Table.Cell>{s.id + 1}</Table.Cell>
                        <Table.Cell>
                          <span className="flex min-w-0 flex-col gap-1">
                            <span className="font-mono text-sm text-primary">{s.text}</span>
                            {s.note && <span className="text-sm text-tertiary wrap-anywhere">{s.note}</span>}
                          </span>
                        </Table.Cell>
                        <Table.Cell>
                          <span className="flex flex-wrap items-center gap-2">
                            <StepBadge status={s.status} />
                            {s.ms !== undefined && <span className="text-sm text-tertiary">{`${(s.ms / 1000).toFixed(1)}s`}</span>}
                          </span>
                        </Table.Cell>
                      </Table.Row>
                    )}
                  </Table.Body>
                </Table>
              </div>
            </TableCard.Root>
          )}
        </section>
      </div>

      <TableCard.Root>
        <TableCard.Header title="Versions" description="Every save and AI edit, newest first. Restore puts a version back in the editor; Save keeps it." />
        {versions.length === 0 ? (
          <div className="px-6 pb-6">
            <Body2>No versions yet. One is kept each time you save or use AI.</Body2>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table aria-label="Versions" size="sm">
              <Table.Header>
                <Table.Head id="when" label="When" isRowHeader />
                <Table.Head id="what" label="What" />
                <Table.Head id="device" label="Device" className="hidden md:table-cell" />
                <Table.Head id="by" label="By" className="hidden lg:table-cell" />
                <Table.Head id="restore" label="Restore" />
              </Table.Header>
              <Table.Body items={versions} dependencies={[draft, canEdit]}>
                {(v) => (
                  <Table.Row id={v.id}>
                    <Table.Cell>{new Date(v.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</Table.Cell>
                    <Table.Cell>
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="text-sm text-primary">{SOURCE[v.source]}</span>
                        {v.prompt && <span className="text-sm text-tertiary wrap-anywhere">{`“${v.prompt}”`}</span>}
                        {v.sessionName && <span className="text-sm text-tertiary">{`Signs in with ${v.sessionName}`}</span>}
                      </span>
                    </Table.Cell>
                    <Table.Cell className="hidden md:table-cell">{v.device}</Table.Cell>
                    <Table.Cell className="hidden lg:table-cell">{v.by}</Table.Cell>
                    <Table.Cell>
                      {sameDraft(v, draft) ? (
                        <span className="text-sm text-tertiary">In editor</span>
                      ) : (
                        <Button
                          color="secondary"
                          size="sm"
                          isDisabled={!canEdit}
                          aria-label={`Restore the version from ${new Date(v.at).toLocaleString()}`}
                          onClick={() => {
                            setDraft({ markdown: v.markdown, device: v.device, sessionTestId: v.sessionTestId });
                            setTab("write");
                            toast.success("Version restored in the editor. Save to keep it.");
                          }}
                        >
                          Restore
                        </Button>
                      )}
                    </Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table>
          </div>
        )}
      </TableCard.Root>

      <TableCard.Root>
        <TableCard.Header title="Run history" description="The newest 15 runs. Open one to see a screenshot for every step." />
        {history.length === 0 ? (
          <div className="px-6 pb-6">
            <Body2>No runs yet.</Body2>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table aria-label="Run history" onRowAction={(id) => router.push(`/runs/${id}`)}>
              <Table.Header>
                <Table.Head id="when" label="Started" isRowHeader />
                <Table.Head id="status" label="Result" />
                <Table.Head id="steps" label="Steps passed" />
                <Table.Head id="time" label="Duration" className="hidden md:table-cell" />
                <Table.Head id="by" label="Run by" className="hidden md:table-cell" />
              </Table.Header>
              <Table.Body items={history}>
                {(h) => (
                  <Table.Row id={h.id}>
                    <Table.Cell>
                      <Button color="link-gray" href={`/runs/${h.id}`}>
                        {new Date(h.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                      </Button>
                    </Table.Cell>
                    <Table.Cell><RunBadge status={h.status} /></Table.Cell>
                    <Table.Cell>{`${h.passed} / ${h.total}`}</Table.Cell>
                    <Table.Cell className="hidden md:table-cell">{h.ms === null ? "—" : `${(h.ms / 1000).toFixed(1)}s`}</Table.Cell>
                    <Table.Cell className="hidden md:table-cell">{h.by}</Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table>
          </div>
        )}
      </TableCard.Root>
    </div>
  );
}
