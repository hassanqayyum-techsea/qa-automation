"use client";

import { useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { RouterProvider } from "react-aria-components";
import { Toaster } from "@your-job-search-genius/odyssey-ui/components/application/alerts/alert";

declare module "react-aria-components" {
  interface RouterConfig {
    routerOptions: NonNullable<Parameters<ReturnType<typeof useRouter>["push"]>[1]>;
  }
}

const noop = () => () => {};

/** Library links (Button href, sidebar items) navigate client-side through Next's router. */
export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  // Odyssey's Toaster returns a fresh array from getServerSnapshot, which React warns about during
  // SSR/hydration. Mounting it after hydration skips that path; toasts only fire after user actions anyway.
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  return (
    <RouterProvider navigate={router.push}>
      {children}
      {mounted && <Toaster />}
    </RouterProvider>
  );
}
