import type { ReactNode } from "react";
import { Heading } from "@your-job-search-genius/odyssey-ui/components/base/typography/heading";
import { Body1 } from "@your-job-search-genius/odyssey-ui/components/base/typography/body-1";

/** Page title top-left, page actions top-right (stacked on narrow screens). */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <Heading level={1} size={3}>{title}</Heading>
        {description && <Body1>{description}</Body1>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </header>
  );
}

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
