// Pure data, safe to import from client components (the shell hides nav items with it).
// Hiding UI is never authorization: every server action and query re-checks via requirePermission().

export const PERMISSIONS = {
  "analytics:view": "See dashboards, contributors and the leaderboard for visible repos",
  "hidden:view": "See hidden orgs and repos and include them in totals",
  "scope:manage": "Enable, disable or hide orgs and repos",
  "sync:run": "Start a sync and see sync errors",
  "hooks:view": "See webhook events and webhook secrets",
  "token:manage": "Add, replace or remove GitHub tokens",
  "users:manage": "Create users, reset passwords, assign roles",
  "roles:manage": "Create and edit roles",
  "audit:view": "Read the audit log",
  "apps:manage": "Add and edit apps under test and their test logins",
  "tests:view": "See tests and run results",
  "tests:edit": "Create and edit tests",
  "tests:run": "Run tests against dev and staging apps",
  "tests:run-production": "Run tests against production apps",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const BUILT_IN_ROLES: { name: string; permissions: Permission[] }[] = [
  { name: "Owner", permissions: ALL_PERMISSIONS },
  {
    name: "Admin",
    permissions: ALL_PERMISSIONS.filter((p) => !["token:manage", "users:manage", "roles:manage"].includes(p)),
  },
  { name: "Viewer", permissions: ["analytics:view", "tests:view"] },
];
