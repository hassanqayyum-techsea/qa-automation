import { Suspense } from "react";
import { LoadingIndicator } from "@your-job-search-genius/odyssey-ui/components/application/loading-indicator/loading-indicator";
import { requireUser } from "~/lib/auth";
import { Shell } from "./shell";
import { LiveRefresh } from "./live-refresh";

// Every console screen depends on the signed-in user and fresh data, so it renders at request time.
export const instant = false;

export default function ConsoleLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center">
          <LoadingIndicator type="line-simple" size="md" label="Loading" />
        </div>
      }
    >
      <ShellForUser>{children}</ShellForUser>
    </Suspense>
  );
}

async function ShellForUser({ children }: { children: React.ReactNode }) {
  const { name, email, role, permissions } = await requireUser();
  return (
    <Shell user={{ name, email, role, permissions }}>
      {children}
      <LiveRefresh />
    </Shell>
  );
}
