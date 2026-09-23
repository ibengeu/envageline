export type MoveOrigin =
  | "user:tap"
  | "user:key"
  | "user:button"
  | "auto:next"
  | "restore"
  | "reconcile";

export interface NarrationMove {
  origin: MoveOrigin;
  fromId: string | null;
  toId: string | null;
  fromIndex: number | null;
  toIndex: number | null;
  page: number | null;
}

export interface JumpLogEntry extends NarrationMove {
  at: number;
  unexpected: boolean;
}

export interface JumpLog {
  record(move: NarrationMove): JumpLogEntry;
  entries(): JumpLogEntry[];
  unexpected(): JumpLogEntry[];
}

function isListenerRequest(origin: MoveOrigin): boolean {
  return origin.startsWith("user:");
}

// Narration left alone may only stay on its sentence or carry on to the next
// one; anything else it does by itself is the bug this log exists to catch.
function isUnexpected(move: NarrationMove): boolean {
  if (isListenerRequest(move.origin)) return false;
  // Having to reconcile without knowing where narration was is itself the
  // failure: whatever it lands on is a guess.
  if (move.origin === "reconcile" && move.fromIndex === null) return true;
  if (move.fromIndex === null || move.toIndex === null) return false;
  const step = move.toIndex - move.fromIndex;
  return step !== 0 && step !== 1;
}

export function createJumpLog({
  capacity = 2000,
  now,
}: {
  capacity?: number;
  now: () => number;
}): JumpLog {
  const log: JumpLogEntry[] = [];
  const limit = Math.max(1, Math.floor(capacity));
  return {
    record(move) {
      // OWASP A09:2025 - copy the named fields only, never a spread, so a
      // caller handing over a whole sentence cannot leak document text.
      const entry: JumpLogEntry = {
        origin: move.origin,
        fromId: move.fromId,
        toId: move.toId,
        fromIndex: move.fromIndex,
        toIndex: move.toIndex,
        page: move.page,
        at: now(),
        unexpected: isUnexpected(move),
      };
      // OWASP A09:2025 Security Logging and Alerting Failures - a bounded
      // ring, so diagnostics can run for a whole book without growing memory.
      log.push(entry);
      if (log.length > limit) log.splice(0, log.length - limit);
      return entry;
    },
    entries: () => [...log],
    unexpected: () => log.filter((entry) => entry.unexpected),
  };
}
