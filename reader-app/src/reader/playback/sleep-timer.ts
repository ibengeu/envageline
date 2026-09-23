export type SleepTimerMode = "off" | "timed" | "end-of-chapter";

export interface SleepTimerDeps {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  onExpire(): void;
}

export interface SleepTimer {
  readonly mode: SleepTimerMode;
  start(minutes: number): void;
  cancel(): void;
  stopAtChapterEnd(): void;
  /** Called before each next sentence; true means playback should stop here. */
  shouldStopBefore(next: { type: string }): boolean;
}

export function createSleepTimer(deps: SleepTimerDeps): SleepTimer {
  let mode: SleepTimerMode = "off";
  let handle: unknown = null;

  function clear(): void {
    if (handle !== null) deps.clearTimer(handle);
    handle = null;
    mode = "off";
  }

  return {
    get mode() {
      return mode;
    },
    start(minutes) {
      clear();
      mode = "timed";
      handle = deps.setTimer(() => {
        handle = null;
        mode = "off";
        deps.onExpire();
      }, minutes * 60_000);
    },
    cancel() {
      clear();
    },
    stopAtChapterEnd() {
      clear();
      mode = "end-of-chapter";
    },
    shouldStopBefore(next) {
      if (mode !== "end-of-chapter") return false;
      if (next.type !== "heading" && next.type !== "title") return false;
      clear();
      deps.onExpire();
      return true;
    },
  };
}
