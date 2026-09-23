import type { PlaybackState } from "../core/types.ts";

/** "aborted": playback was superseded; "stale-context": voice or rate changed
 * mid-fetch, so the same sentence should be spoken again. */
export type SpeakResult = "completed" | "aborted" | "stale-context";

export interface PlaybackSessionDeps<S extends { id: string }> {
  speak(segment: S, isCurrent: () => boolean): Promise<SpeakResult>;
  pauseAudio(): void;
  resumeAudio(): void;
  stopAudio(): void;
  /** Where narration starts when there is no current position. */
  first(): Promise<S | null>;
  next(segment: S): Promise<S | null>;
  onChange(state: { status: PlaybackState; segment: S | null }): void;
  onError(cause: unknown): void;
}

export interface PlaybackSession<S extends { id: string }> {
  readonly status: PlaybackState;
  readonly current: S | null;
  play(): void;
  pause(): void;
  /** Moves narration to `segment`. Keeps playing if it was playing, unless
   * `autoplay` says otherwise. */
  seek(segment: S, options?: { autoplay?: boolean }): void;
  stop(): void;
  /** Holds narration while a book opens: play is remembered, not started,
   * until the first seek says where the listener left off. */
  prepare(): void;
}

export function createPlaybackSession<S extends { id: string }>(
  deps: PlaybackSessionDeps<S>,
): PlaybackSession<S> {
  let status: PlaybackState = "idle";
  let current: S | null = null;
  let run = 0;
  let narrating = false;
  let paused = false;
  let wake: (() => void) | null = null;
  // While a book opens: null = not holding; false/true = holding, and
  // whether play was pressed in the meantime.
  let held: boolean | null = null;

  // Parks the narration loop between sentences while paused, so a sentence
  // that ends during a pause never lets the next one start on its own.
  function whilePaused(): Promise<void> {
    if (!paused) return Promise.resolve();
    return new Promise((resolve) => {
      wake = resolve;
    });
  }

  // Ends whatever narration owns the speaker so a new one can take over.
  function supersede(): void {
    run += 1;
    narrating = false;
    paused = false;
    release();
    deps.stopAudio();
  }

  function start(): void {
    run += 1;
    update({ status: "preparing" });
    void narrate(run);
  }

  function release(): void {
    const resume = wake;
    wake = null;
    resume?.();
  }

  function update(next: { status?: PlaybackState; segment?: S | null }): void {
    if (next.status !== undefined) status = next.status;
    if (next.segment !== undefined) current = next.segment;
    deps.onChange({ status, segment: current });
  }

  async function narrate(id: number): Promise<void> {
    narrating = true;
    try {
      let segment = current ?? (await deps.first());
      while (id === run && segment) {
        await whilePaused();
        if (id !== run) return;
        update({ status: "playing", segment });
        const outcome = await deps.speak(segment, () => id === run);
        if (id !== run || outcome === "aborted") return;
        if (outcome === "stale-context") continue;
        segment = await deps.next(segment);
      }
      if (id === run) update({ status: "completed" });
    } catch (cause) {
      // OWASP A10:2025 Mishandling of Exceptional Conditions - a failed
      // sentence ends this narration cleanly (no half-alive loop holding the
      // speaker) and leaves the position on it so play can retry.
      if (id !== run) return;
      update({ status: "error" });
      deps.onError(cause);
    } finally {
      if (id === run) narrating = false;
    }
  }

  return {
    get status() {
      return status;
    },
    get current() {
      return current;
    },
    play() {
      // OWASP A06:2025 Insecure Design - starting before the saved position
      // is known would narrate from the wrong place and then be yanked away.
      if (held !== null) {
        held = true;
        update({ status: "preparing" });
        return;
      }
      // OWASP A06:2025 Insecure Design - exactly one narration may own the
      // speaker; a repeated play request joins the one already running.
      if (narrating && paused) {
        paused = false;
        deps.resumeAudio();
        update({ status: "playing" });
        release();
        return;
      }
      if (narrating) return;
      start();
    },
    pause() {
      if (!narrating || paused) return;
      paused = true;
      deps.pauseAudio();
      update({ status: "paused" });
    },
    seek(segment, options = {}) {
      const wasPlaying = narrating && !paused;
      const playRequested = held === true;
      held = null;
      supersede();
      update({ segment });
      if (playRequested || (options.autoplay ?? wasPlaying)) start();
    },
    stop() {
      held = null;
      supersede();
      update({ status: "idle" });
    },
    prepare() {
      held = false;
    },
  };
}
