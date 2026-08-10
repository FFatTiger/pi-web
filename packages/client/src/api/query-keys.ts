/**
 * Central TanStack Query key factory.
 * Keep keys hierarchical so invalidation stays precise.
 */

export const queryKeys = {
  root: ["pi-web"] as const,
  gate: {
    all: ["pi-web", "gate"] as const,
    status: () => ["pi-web", "gate", "status"] as const,
  },
  sessions: {
    all: ["pi-web", "sessions"] as const,
    list: (params?: { cwd?: string }) =>
      ["pi-web", "sessions", "list", params ?? {}] as const,
    detail: (id: string) => ["pi-web", "sessions", "detail", id] as const,
  },
  capabilities: {
    host: () => ["pi-web", "capabilities", "host"] as const,
  },
} as const;
