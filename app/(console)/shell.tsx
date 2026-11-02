"use client";

import { useTransition } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { SidebarLayout } from "@your-job-search-genius/odyssey-ui/components/application/sidebar/sidebar";
import type { SidebarNavItem } from "@your-job-search-genius/odyssey-ui/components/application/sidebar/sidebar";
import {
  ClipboardCheck, GitBranch01, Home02, LogOut01, Settings01, Users01, Zap,
} from "@your-job-search-genius/odyssey-ui/components/foundations/icons";
import type { Permission } from "~/lib/permissions";
import { logout } from "~/app/login/actions";

type NavDef = Omit<SidebarNavItem, "items"> & { perm?: Permission; items?: { label: string; href: string; perm: Permission }[] };

const NAV: NavDef[] = [
  { label: "Dashboard", href: "/", icon: Home02, perm: "analytics:view" },
  { label: "Contributors", href: "/contributors", icon: Users01, perm: "analytics:view" },
  { label: "Repositories", href: "/repos", icon: GitBranch01, perm: "analytics:view" },
  { label: "Tests", href: "/apps", icon: ClipboardCheck, perm: "tests:view", matchHrefs: ["/runs"] },
  { label: "Webhooks", href: "/hooks", icon: Zap, perm: "hooks:view" },
  {
    label: "Settings",
    icon: Settings01,
    items: [
      { label: "Users", href: "/settings/users", perm: "users:manage" },
      { label: "Roles", href: "/settings/roles", perm: "roles:manage" },
      { label: "Audit log", href: "/settings/audit", perm: "audit:view" },
    ],
  },
];

export function Shell({
  user,
  children,
}: {
  user: { name: string; email: string; role: string; permissions: Permission[] };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [, startTransition] = useTransition();
  const has = (p?: Permission) => !p || user.permissions.includes(p);

  // Destinations the user can't use are hidden, not disabled (the server enforces access regardless).
  const items: SidebarNavItem[] = NAV.filter((n) => has(n.perm)).flatMap((n) => {
    const children = n.items?.filter((c) => has(c.perm)).map((c) => ({ label: c.label, href: c.href }));
    if (children && children.length === 0) return []; // a group with nothing allowed disappears
    return [{ label: n.label, icon: n.icon, href: n.href, matchHrefs: n.matchHrefs, items: children }];
  });

  return (
    <SidebarLayout
      brand={{ name: "Repo Pulse" }}
      activeUrl={search ? `${pathname}?${search}` : pathname}
      items={items}
      account={{
        name: user.name,
        email: `${user.email} · ${user.role}`,
        menuItems: [{ id: "logout", label: "Log out", icon: LogOut01, onAction: () => startTransition(() => logout()) }],
      }}
    >
      {children}
    </SidebarLayout>
  );
}
