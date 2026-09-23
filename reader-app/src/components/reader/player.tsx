import {
  BookmarkPlus,
  ChevronDown,
  ChevronFirst,
  ChevronLast,
  ChevronUp,
  FastForward,
  Gauge,
  Moon,
  Pause,
  Play,
  Rewind,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  addBookmarkHere,
  nextSegment,
  previousSegment,
  setRate,
  setSleepTimer,
  setVoice,
  skipChapter,
  skipInterval,
  togglePlay,
} from "@/reader/controller";
import { listeningProgress } from "@/reader/playback/listening";
import { RATE_PRESETS, RATE_STEP } from "@/reader/core/config";
import { useReaderStore } from "@/reader/core/store";
import { cn } from "@/lib/utils";

export function Player() {
  const playback = useReaderStore((s) => s.playback);
  const documentSlice = useReaderStore((s) => s.document);
  const segmentsByPage = useReaderStore((s) => s.segmentsByPage);
  const processing = useReaderStore((s) => s.processing);
  const minimized = useReaderStore((s) => s.playerMinimized);
  const skipSeconds = useReaderStore((s) => s.skipIntervalSeconds);
  const sleepTimer = useReaderStore((s) => s.sleepTimer);
  const ordered = useMemo(() => Object.values(segmentsByPage).flat(), [segmentsByPage]);
  const progress = listeningProgress(
    ordered,
    Math.max(0, ordered.findIndex((segment) => segment.id === playback.currentSegmentId)),
    playback.rate,
  );

  const busy =
    playback.status === "preparing" || playback.status === "buffering";
  const playing = playback.status === "playing" || busy;
  const active = Object.values(segmentsByPage)
    .flat()
    .find((segment) => segment.id === playback.currentSegmentId);
  const readyPages = Object.keys(segmentsByPage).length;
  const pageCount = documentSlice?.model.pageCount ?? 0;

  return (
    <div className="relative border-t border-border bg-surface/95 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:px-5">
      <Button
        variant="ghost"
        size="icon-sm"
        className="absolute right-2 top-2 sm:right-4 sm:top-2"
        aria-label={minimized ? "Expand player" : "Minimize player"}
        onClick={() => useReaderStore.getState().setPlayerMinimized(!minimized)}
      >
        {minimized ? <ChevronUp /> : <ChevronDown />}
      </Button>
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3">
        {!minimized && (
          <p className="line-clamp-2 w-full max-w-3xl text-center text-sm text-fg">
            {busy
              ? "Preparing the next passage…"
              : active?.originalText || "Press play to start listening"}
          </p>
        )}
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center justify-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous chapter"
              onClick={() => skipChapter(-1)}
            >
              <ChevronFirst />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Back ${skipSeconds} seconds`}
              onClick={() => skipInterval(-1)}
            >
              <Rewind />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous sentence"
              onClick={() => void previousSegment()}
            >
              <SkipBack />
            </Button>
            <Button
              size="icon"
              className="size-12 rounded-full"
              aria-label={playing ? "Pause" : "Play"}
              onClick={() => togglePlay()}
              disabled={!documentSlice}
            >
              <span className="relative block size-5">
                <Play
                  className={cn(
                    "absolute inset-0 ml-0.5 size-5 transition-[opacity,transform,filter] duration-200",
                    playing ? "scale-[0.25] opacity-0 blur-[4px]" : "scale-100 opacity-100",
                  )}
                />
                <Pause
                  className={cn(
                    "absolute inset-0 size-5 transition-[opacity,transform,filter] duration-200",
                    playing ? "scale-100 opacity-100" : "scale-[0.25] opacity-0 blur-[4px]",
                  )}
                />
              </span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next sentence"
              onClick={() => void nextSegment()}
            >
              <SkipForward />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Forward ${skipSeconds} seconds`}
              onClick={() => skipInterval(1)}
            >
              <FastForward />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next chapter"
              onClick={() => skipChapter(1)}
            >
              <ChevronLast />
            </Button>
          </div>

          {!minimized && (
            <div className="flex flex-wrap items-center justify-center gap-3">
              <label className="flex items-center gap-2 text-xs text-muted">
                <Gauge className="size-3.5" />
                <select
                  className="h-9 rounded-lg bg-surface-2 px-2 text-fg shadow-[var(--shadow-border)]"
                  value={
                    RATE_PRESETS.includes(
                      playback.rate as (typeof RATE_PRESETS)[number],
                    )
                      ? String(playback.rate)
                      : "custom"
                  }
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isFinite(value)) setRate(value);
                  }}
                  aria-label="Playback speed"
                >
                  {RATE_PRESETS.map((rate) => (
                    <option key={rate} value={rate}>
                      {rate}×
                    </option>
                  ))}
                  {!RATE_PRESETS.includes(
                    playback.rate as (typeof RATE_PRESETS)[number],
                  ) && <option value="custom">{playback.rate}×</option>}
                </select>
              </label>
              <input
                type="range"
                min={0.5}
                max={3}
                step={RATE_STEP}
                value={playback.rate}
                onChange={(event) => setRate(Number(event.target.value))}
                className="h-9 w-28 accent-accent"
                aria-label="Playback rate"
              />
              <label className="flex items-center gap-2 text-xs text-muted">
                <Moon className="size-3.5" />
                <select
                  className="h-9 rounded-lg bg-surface-2 px-2 text-fg shadow-[var(--shadow-border)]"
                  aria-label="Sleep timer"
                  value={
                    sleepTimer.mode === "end-of-chapter"
                      ? "end-of-chapter"
                      : sleepTimer.mode === "off"
                        ? "off"
                        : "running"
                  }
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === "off" || value === "end-of-chapter") setSleepTimer(value);
                    else if (Number.isFinite(Number(value))) setSleepTimer(Number(value));
                  }}
                >
                  <option value="off">Sleep off</option>
                  {sleepTimer.mode === "timed" && (
                    <option value="running">
                      Sleep at{" "}
                      {new Date(sleepTimer.endsAt ?? 0).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </option>
                  )}
                  {[15, 30, 45, 60].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} min
                    </option>
                  ))}
                  <option value="end-of-chapter">End of chapter</option>
                </select>
              </label>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Bookmark this sentence"
                onClick={() => addBookmarkHere()}
                disabled={!playback.currentSegmentId}
              >
                <BookmarkPlus />
              </Button>
              <label className="sr-only" htmlFor="voice-select">
                Voice
              </label>
              <select
                id="voice-select"
                className="h-9 max-w-[180px] rounded-lg bg-surface-2 px-2 text-xs text-fg shadow-[var(--shadow-border)]"
                value={playback.voiceId ?? ""}
                onChange={(event) => setVoice(event.target.value)}
              >
                {playback.voices.length === 0 && <option value="">Default voice</option>}
                {playback.voices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name} ({voice.lang})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        {ordered.length > 0 && (
          <div className="flex w-full max-w-xl items-center gap-2 text-[11px] tabular-nums text-subtle">
            <span>{progress.percent}%</span>
            <div
              className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2"
              role="progressbar"
              aria-label="Listening progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress.percent}
            >
              <div className="h-full bg-accent" style={{ width: `${progress.percent}%` }} />
            </div>
            <span>{formatRemaining(progress.remainingSeconds)} left</span>
          </div>
        )}
        {!minimized && (
          <p className="text-center text-[11px] tabular-nums text-subtle">
            {readyPages} / {pageCount} pages ready
            {processing.activePage ? ` · processing p. ${processing.activePage}` : ""}
            {playback.status === "paused" ? " · paused" : ""}
          </p>
        )}
      </div>
    </div>
  );
}

function formatRemaining(seconds: number): string {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
