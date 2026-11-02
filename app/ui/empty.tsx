"use client";

import type { ReactNode } from "react";
import { EmptyState } from "@your-job-search-genius/odyssey-ui/components/application/empty-state/empty-state";
import {
  AlertCircle, ClipboardCheck, GitBranch01, SearchLg, Shield01, Users01, Zap,
} from "@your-job-search-genius/odyssey-ui/components/foundations/icons";

// Icons are functions, which Server Components can't pass to client components, so pages pick one by name.
const ICONS = { AlertCircle, ClipboardCheck, GitBranch01, SearchLg, Shield01, Users01, Zap };

export function Empty({
  icon,
  color = "gray",
  title,
  description,
  actions,
  size = "md",
}: {
  icon: keyof typeof ICONS;
  color?: "brand" | "gray" | "success" | "warning" | "error";
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <EmptyState size={size}>
      <EmptyState.Header>
        <EmptyState.FeaturedIcon icon={ICONS[icon]} color={color} />
      </EmptyState.Header>
      <EmptyState.Content>
        <EmptyState.Title>{title}</EmptyState.Title>
        <EmptyState.Description>{description}</EmptyState.Description>
      </EmptyState.Content>
      {actions && <EmptyState.Footer>{actions}</EmptyState.Footer>}
    </EmptyState>
  );
}
