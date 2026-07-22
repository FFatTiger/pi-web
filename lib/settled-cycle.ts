export type SettledCandidate = { messages: unknown[]; willRetry?: boolean };
export type SettledCycleSnapshot = { sessionId: string; cycleId: number; messages: unknown[] };

type Active = {
  cycleId: number;
  candidate: SettledCandidate | null;
};

export class SettledCycleTracker {
  private nextCycleId = 1;
  private active: Active | null = null;

  constructor(private readonly sessionId: string) {}

  accept(event: { type: string; [key: string]: unknown }): SettledCycleSnapshot | null {
    switch (event.type) {
      case "agent_start": {
        // First start when no active cycle opens one; repeated starts retain it.
        if (!this.active) {
          this.active = { cycleId: this.nextCycleId++, candidate: null };
        }
        return null;
      }
      case "agent_end": {
        // Every agent_end updates candidate; later overwrites earlier.
        // willRetry is diagnostic only and never returns a snapshot here.
        if (this.active && Array.isArray(event.messages)) {
          const next: SettledCandidate = {
            messages: event.messages.slice(),
          };
          if (typeof event.willRetry === "boolean") {
            next.willRetry = event.willRetry;
          }
          this.active.candidate = next;
        }
        return null;
      }
      case "agent_settled": {
        // Atomically consume + clear current cycle before notification.
        const active = this.active;
        this.active = null;
        if (!active?.candidate) return null;
        return {
          sessionId: this.sessionId,
          cycleId: active.cycleId,
          messages: active.candidate.messages,
        };
      }
      default:
        return null;
    }
  }
}
