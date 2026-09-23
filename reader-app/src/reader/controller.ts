import { PREFETCH_PAGES, PROCESSING_VERSION } from "./core/config.ts";
import { emit } from "./core/events.ts";
import { appError, logError } from "./core/errors.ts";
import { useReaderStore } from "./core/store.ts";
import type {
  DocumentAnalysis,
  BuiltInReadingProfileId,
  ExtractedPage,
  NarrationSegment,
  RecentDocument,
  ReadingProfile,
  TTSOptions,
} from "./core/types.ts";
import { compileDocument } from "./narration/compiler.ts";
import {
  AUDIOBOOK_READING_PROFILE,
  DIAGNOSTIC_READING_PROFILE,
  INCLUSIVE_READING_PROFILE,
  withContentFilters,
  type ContentFilters,
} from "./narration/reading-profile.ts";
import {
  extractPage,
  extractPageWithOcr,
  openPdf,
  releasePdf,
  renderPage,
  cancelRender,
  renderTextLayer,
  cancelTextLayer,
} from "./pdf/pdf-engine.ts";
import { createSamplePdf } from "./sample.ts";
import { KokoroSpeechEngine, type TTSEngine } from "./speech/kokoro-tts.ts";
import { createReadAheadScheduler, type ReadAheadScheduler } from "./speech/read-ahead.ts";
import { isSpeechSupported, pickDefaultVoice } from "./speech/kokoro-voice-manager.ts";
import { reportTtsFailure } from "./controller-failure.ts";
import { createPlaybackSession, type SpeakResult } from "./playback/session.ts";
import { addBookmark } from "./playback/bookmarks.ts";
import { chapterTarget, skipTarget } from "./playback/listening.ts";
import { createSleepTimer } from "./playback/sleep-timer.ts";
import { progressToSave, restoredSegment } from "./playback/position.ts";
import { createJumpLog, type JumpLogEntry, type MoveOrigin } from "./playback/jump-log.ts";
import { nextAfter, resolveSegment } from "./playback/resolve.ts";
import { normalizeRate } from "./playback/rate.ts";
import {
  getDocumentFile,
  getProgress,
  listDocuments,
  loadBookmarks,
  saveBookmarks,
  loadSettings,
  saveDocumentFile,
  saveDocumentMeta,
  saveProgress,
  saveSegments,
  saveSettings,
} from "./storage/database.ts";

const tts = new KokoroSpeechEngine();
const readAhead = createReadAheadScheduler(tts);
const jumpLog = createJumpLog({ now: () => Date.now() });

/** The recent narration moves (ids, indices and origins only - never text),
 * for copying into a bug report. */
export function getNarrationDiagnostics(): JumpLogEntry[] {
  return jumpLog.entries();
}

function indexIn(segments: readonly NarrationSegment[], segment: NarrationSegment | null): number | null {
  return segment ? resolveSegment(segment, segments) : null;
}

function recordMove(origin: MoveOrigin, from: NarrationSegment | null, to: NarrationSegment | null): void {
  const all = orderedSegments();
  const entry = jumpLog.record({
    origin,
    fromId: from?.id ?? null,
    toId: to?.id ?? null,
    fromIndex: indexIn(all, from),
    toIndex: indexIn(all, to),
    page: to?.page ?? from?.page ?? null,
  });
  if (entry.unexpected) console.warn("[narration] unexpected jump", entry);
}

export { reportTtsFailure } from "./controller-failure.ts";

let processingToken = 0;
let persistTimer: number | null = null;
let speechContext = 0;
let extractedPages = new Map<number, ExtractedPage>();
let activeAnalysis: DocumentAnalysis | null = null;
let activeReadingProfile: ReadingProfile = AUDIOBOOK_READING_PROFILE;

export function getActiveDocumentAnalysis(): DocumentAnalysis | null {
  return activeAnalysis;
}

const READING_PROFILES: Record<BuiltInReadingProfileId, ReadingProfile> = {
  audiobook: AUDIOBOOK_READING_PROFILE,
  inclusive: INCLUSIVE_READING_PROFILE,
  diagnostic: DIAGNOSTIC_READING_PROFILE,
};

export function getActiveReadingProfileId(): BuiltInReadingProfileId {
  return activeReadingProfile.id as BuiltInReadingProfileId;
}

function store() {
  return useReaderStore.getState();
}

function pageCount(): number {
  return store().document?.model.pageCount ?? 0;
}

function segmentsOn(page: number): NarrationSegment[] {
  return store().segmentsByPage[page] ?? [];
}

function orderedSegments(): NarrationSegment[] {
  const list: NarrationSegment[] = [];
  for (let page = 1; page <= pageCount(); page += 1) {
    list.push(...segmentsOn(page));
  }
  return list;
}

function currentSpeechOptions(): TTSOptions {
  return {
    rate: store().playback.rate,
    voiceId: store().playback.voiceId,
  };
}

function resetReadAhead(): void {
  speechContext += 1;
  readAhead.reset();
}

function prefetchAudioAhead(segment: NarrationSegment, options = currentSpeechOptions()): void {
  const segments = orderedSegments();
  const index = indexIn(segments, segment);
  if (index === null) return;
  readAhead.prefetch(segments, index, options);
}

function findSegment(id: string | null): NarrationSegment | null {
  if (!id) return null;
  return orderedSegments().find((segment) => segment.id === id) ?? null;
}

async function persistNow(): Promise<void> {
  const state = store();
  if (!state.document) return;
  const progress = progressToSave(
    state.document.model.id,
    findSegment(state.playback.currentSegmentId),
    state.playback.currentSegmentIndex,
  );
  if (progress) await saveProgress(progress);
  await persistSettings();
}

function persistSettings(): Promise<void> {
  const state = store();
  const filters = state.contentFilters;
  return saveSettings({
    rate: state.playback.rate,
    voiceId: state.playback.voiceId,
    skipCaptions: true,
    skipFootnotes: filters.footnotes === "skip",
    skipReferences: filters.skipReferences,
    readingProfileId: getActiveReadingProfileId(),
    contentFilters: filters,
    skipIntervalSeconds: state.skipIntervalSeconds,
  });
}

// The audiobook profile is the one listeners tune: their filter switches are
// layered over it. Inclusive and diagnostic read everything by definition.
function effectiveProfile(): ReadingProfile {
  if (activeReadingProfile.id !== "audiobook") return activeReadingProfile;
  return withContentFilters(activeReadingProfile, store().contentFilters);
}

function schedulePersist(): void {
  if (persistTimer !== null) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    void persistNow();
  }, 1200);
}

function processingIsCurrent(token: number, documentId: string): boolean {
  return token === processingToken && store().document?.model.id === documentId;
}

function pageIsInDocument(pageNumber: number, pageTotal: number): boolean {
  return pageNumber >= 1 && pageNumber <= pageTotal;
}

function pageIsFullyAnalyzed(page: ExtractedPage | undefined): boolean {
  return Boolean(page?.layoutAttempted && (!page.scanned || page.ocrApplied));
}

function pageNeedsOcrResult(page: ExtractedPage): boolean {
  return Boolean(page.scanned && !page.ocrApplied);
}

function handleEmptyScannedPage(page: ExtractedPage): boolean {
  if (!page.scanned || page.textLength > 0) return false;
  store().setNotice(
    `OCR could not find readable text on page ${page.page}. The page remains available visually.`,
  );
  store().setPageState(page.page, "ocr-required");
  return true;
}

function handlePageFailure(pageNumber: number, cause: unknown): void {
  logError("NARRATION_FAILED", cause);
  store().setPageState(pageNumber, "error");
  store().setSegments(pageNumber, []);
}

function clearActivePage(token: number, documentId: string): void {
  if (processingIsCurrent(token, documentId)) store().setActivePage(null);
}

interface PageProcessingContext {
  documentId: string;
  known?: ExtractedPage;
  token: number;
}

function pageProcessingContext(pageNumber: number): PageProcessingContext | null {
  const state = store();
  if (!state.document || !pageIsInDocument(pageNumber, state.document.model.pageCount)) return null;
  const known = extractedPages.get(pageNumber);
  if (state.segmentsByPage[pageNumber] && pageIsFullyAnalyzed(known)) return null;
  return {
    documentId: state.document.model.id,
    known,
    token: processingToken,
  };
}

async function pageForAnalysis(
  context: PageProcessingContext,
  pageNumber: number,
): Promise<ExtractedPage> {
  if (context.known && pageIsFullyAnalyzed(context.known)) return context.known;
  return extractPageWithOcr(context.documentId, pageNumber);
}

async function processPage(pageNumber: number, _urgent: boolean): Promise<void> {
  const context = pageProcessingContext(pageNumber);
  if (!context) return;
  const { documentId, known, token } = context;
  store().setPageState(pageNumber, known?.scanned ? "ocr-processing" : "extracting");
  store().setActivePage(pageNumber);
  try {
    const extracted = await pageForAnalysis(context, pageNumber);
    if (!processingIsCurrent(token, documentId)) return;
    extractedPages.set(pageNumber, extracted);
    if (handleEmptyScannedPage(extracted)) return;
    store().setPageState(pageNumber, "layout-processing");
    await compileKnownDocument(documentId, token);
    if (!processingIsCurrent(token, documentId)) return;
    emit("page:processed", { page: pageNumber });
    emit("narration:ready", { page: pageNumber });
  } catch (cause) {
    handlePageFailure(pageNumber, cause);
  } finally {
    clearActivePage(token, documentId);
  }
}

async function compileKnownDocument(documentId: string, token = processingToken): Promise<void> {
  const pages = [...extractedPages.values()].sort((left, right) => left.page - right.page);
  const compiled = compileDocument(pages, effectiveProfile());
  if (!processingIsCurrent(token, documentId)) return;
  activeAnalysis = compiled.analysis;
  for (const page of pages) {
    if (!processingIsCurrent(token, documentId)) return;
    if (pageNeedsOcrResult(page)) continue;
    const segments = compiled.segments.filter((segment) => segment.page === page.page);
    store().setSegments(page.page, segments);
    store().setPageState(page.page, "narration-ready");
    await saveSegments(documentId, page.page, segments);
  }
}

async function prepareNativeDocument(documentId: string, count: number): Promise<void> {
  extractedPages = new Map<number, ExtractedPage>();
  activeAnalysis = null;
  for (let page = 1; page <= count; page += 1) {
    store().setPageState(page, "extracting");
    const extracted = await extractPage(documentId, page);
    extractedPages.set(page, extracted);
    store().setPageState(page, extracted.scanned ? "ocr-required" : "text-ready");
  }
  await compileKnownDocument(documentId);
}

async function prefetchAround(center: number): Promise<void> {
  const state = store();
  if (!state.document) return;
  const token = processingToken;
  const pages: number[] = [];
  for (let offset = 0; offset <= PREFETCH_PAGES; offset += 1) {
    const next = center + offset;
    const prev = center - offset;
    if (next >= 1 && next <= state.document.model.pageCount) pages.push(next);
    if (offset > 0 && prev >= 1) pages.push(prev);
  }
  const unique = [...new Set(pages)];
  store().setQueued(unique.filter((page) => !store().segmentsByPage[page]));
  for (const [index, page] of unique.entries()) {
    if (token !== processingToken) return;
    await processPage(page, index === 0);
  }
}

async function refreshRecents(): Promise<void> {
  const docs = await listDocuments();
  const recents: RecentDocument[] = [];
  for (const doc of docs) {
    const progress = await getProgress(doc.id);
    recents.push({ ...doc, progress: progress ?? undefined });
  }
  store().setRecents(recents);
}

export async function initReader(): Promise<void> {
  store().setTtsSupported(isSpeechSupported());
  try {
    await tts.initialize();
    const voices = await tts.getVoices();
    const settings = await loadSettings();
    activeReadingProfile = READING_PROFILES[settings.readingProfileId] ?? AUDIOBOOK_READING_PROFILE;
    store().setReadingProfileId(getActiveReadingProfileId());
    store().setContentFilters(settings.contentFilters);
    store().setSkipIntervalSeconds(settings.skipIntervalSeconds);
    const voiceId = pickDefaultVoice(voices, settings.voiceId);
    store().patchPlayback({ voices, voiceId, rate: settings.rate });
  } catch (cause) {
    logError("TTS_FAILED", cause);
    store().setTtsSupported(false);
  }
  await refreshRecents();
  store().setHydrated(true);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void persistNow();
  });
  window.addEventListener("beforeunload", () => {
    void persistNow();
  });
}

function applySegment(segment: NarrationSegment | null): void {
  // OWASP A06:2025 Insecure Design - a sentence that cannot be placed keeps
  // the last known index; coercing it to 0 sent skips to the book's start.
  const index = segment ? indexIn(orderedSegments(), segment) : 0;
  store().patchPlayback({
    currentSegmentId: segment?.id ?? null,
    currentSegmentIndex: index ?? store().playback.currentSegmentIndex,
  });
  if (segment && !store().viewer.userScrolling) {
    store().patchViewer({ currentPage: segment.page });
  }
}

async function bindFile(file: File): Promise<void> {
  processingToken += 1;
  session.stop();
  // Play pressed while the book opens is held until the saved position is
  // known, instead of starting on page 1 and then being moved.
  session.prepare();
  resetReadAhead();
  const previous = store().document;
  if (previous) releasePdf(previous.model.id);

  store().resetDocumentState();
  store().setError(null);
  store().setNotice(null);

  const model = await openPdf(file);
  store().setDocument({ model, file });
  emit("document:opened", { id: model.id, pageCount: model.pageCount });

  await saveDocumentMeta({
    id: model.id,
    filename: file.name,
    pageCount: model.pageCount,
    title: model.metadata.title,
    createdAt: Date.now(),
    lastOpenedAt: Date.now(),
    processingVersion: PROCESSING_VERSION,
    byteLength: file.size,
  });
  await saveDocumentFile(model.id, file);
  await refreshRecents();
  await prepareNativeDocument(model.id, model.pageCount);

  store().setBookmarks(await loadBookmarks(model.id));
  const progress = await getProgress(model.id);
  const startPage = progress?.page || 1;
  store().patchViewer({ currentPage: startPage, userScrolling: false });
  store().patchPlayback({
    status: "idle",
    currentSegmentIndex: 0,
    currentSegmentId: null,
  });
  // Resume from the native text layer straight away; the slower OCR/layout
  // pass for nearby pages runs behind it, and stable sentence ids keep the
  // restored position valid when those pages recompile.
  const current = restoredSegment(orderedSegments(), progress);
  void prefetchAround(startPage);
  applySegment(current);
  if (!current) {
    session.stop();
    return;
  }
  recordMove("restore", null, current);
  // The session must know the restored position too, or the first press of
  // play would start from the top of the visible page instead.
  session.seek(current, { autoplay: false });
  prefetchAudioAhead(current);
}

export async function openLocalFile(file: File): Promise<void> {
  try {
    await bindFile(file);
  } catch (cause) {
    session.stop();
    const error =
      cause && typeof cause === "object" && "code" in cause
        ? (cause as { code: "PDF_LOAD_FAILED"; message: string })
        : appError("PDF_LOAD_FAILED", cause);
    store().setError(error);
  }
}

export async function openSample(): Promise<void> {
  const file = await createSamplePdf();
  await openLocalFile(file);
}

export async function openRecent(id: string): Promise<void> {
  const blob = await getDocumentFile(id);
  const meta = store().recents.find((item) => item.id === id);
  if (!blob || !meta) {
    store().setError(appError("PDF_LOAD_FAILED"));
    return;
  }
  const file = new File([blob], meta.filename, { type: "application/pdf" });
  await openLocalFile(file);
}

export function closeDocument(): void {
  processingToken += 1;
  session.stop();
  resetReadAhead();
  void persistNow();
  const current = store().document;
  if (current) releasePdf(current.model.id);
  store().resetDocumentState();
  void refreshRecents();
}

async function firstSegmentFrom(page: number): Promise<NarrationSegment | null> {
  for (let p = page; p <= pageCount(); p += 1) {
    if (!store().segmentsByPage[p]) {
      store().patchPlayback({ status: "buffering" });
      await processPage(p, true);
    }
    const segs = segmentsOn(p);
    if (segs[0]) return segs[0];
  }
  return null;
}

// What the narration reads after `segment`. The page may have been recompiled
// while it was spoken (layout or OCR landing, a filter change), so the
// sentence is found again by what it says and which printed text it covers,
// not by an id that recompiling can retire.
async function followingSegment(segment: NarrationSegment): Promise<NarrationSegment | null> {
  const step = nextAfter(segment, segmentsOn(segment.page));
  if (step.kind === "next") {
    recordMove("auto:next", segment, step.segment);
    return step.segment;
  }
  const next = await firstSegmentFrom(segment.page + 1);
  recordMove(step.kind === "unresolved" ? "reconcile" : "auto:next", segment, next);
  return next;
}

export type SpeakOutcome = "completed" | "aborted" | "stale-context";

export interface SpeakSegmentDeps {
  tts: Pick<TTSEngine, "speak">;
  readAhead: Pick<ReadAheadScheduler, "audioFor">;
  sleep: (ms: number) => Promise<void>;
  isCurrent: () => boolean;
  isContextStale: () => boolean;
  onAudioRequested?: () => void;
}

// The pause a listener gets around a title or heading - a beat before it
// starts, a longer breather once it finishes - lives here so it can be
// exercised without booting the whole playback loop (real store, real PDF,
// real TTS engine). "aborted" means playback itself was superseded (stop, a
// new play generation); "stale-context" means only the voice/rate changed
// mid-fetch, so the caller should retry the same segment rather than give up.
export async function speakSegment(
  segment: NarrationSegment,
  options: TTSOptions,
  deps: SpeakSegmentDeps,
): Promise<SpeakOutcome> {
  const before = segment.speech?.pauseBeforeMs ?? 0;
  if (before > 0) await deps.sleep(before);
  if (!deps.isCurrent()) return "aborted";

  const audioPromise = deps.readAhead.audioFor(segment, options);
  deps.onAudioRequested?.();
  const preparedAudio = await audioPromise;
  if (!deps.isCurrent()) return "aborted";
  if (deps.isContextStale()) return "stale-context";

  await deps.tts.speak(segment, options, preparedAudio);

  const after = segment.speech?.pauseAfterMs ?? 0;
  if (after > 0 && deps.isCurrent()) await deps.sleep(after);
  return deps.isCurrent() ? "completed" : "aborted";
}

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "AbortError";
}

async function speakCurrent(
  segment: NarrationSegment,
  isCurrent: () => boolean,
): Promise<SpeakResult> {
  emit("segment:started", { segmentId: segment.id, page: segment.page });
  schedulePersist();
  void prefetchAround(segment.page);
  const options = currentSpeechOptions();
  const requestContext = speechContext;
  try {
    const outcome = await speakSegment(segment, options, {
      tts,
      readAhead,
      sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
      isCurrent,
      isContextStale: () => requestContext !== speechContext,
      onAudioRequested: () => prefetchAudioAhead(segment, options),
    });
    if (outcome === "completed") emit("segment:completed", { segmentId: segment.id });
    return outcome;
  } catch (cause) {
    // A read-ahead request canceled by a voice or speed change is not a
    // failure: the same sentence is simply fetched again.
    if (isAbort(cause)) return isCurrent() ? "stale-context" : "aborted";
    throw cause;
  }
}

// The single owner of narration: one live run at a time, pause that holds
// between sentences, and seek that supersedes whatever was speaking.
const session = createPlaybackSession<NarrationSegment>({
  speak: speakCurrent,
  pauseAudio: () => tts.pause(),
  resumeAudio: () => tts.resume(),
  stopAudio: () => tts.stop(),
  first: () => firstSegmentFrom(store().viewer.currentPage),
  next: async (segment) => {
    const next = await followingSegment(segment);
    // "End of chapter" sleep: the timer pauses here, and the session's pause
    // gate holds the next chapter's heading until the listener resumes.
    if (next) sleepTimer.shouldStopBefore(next);
    return next;
  },
  onChange: ({ status, segment }) => {
    if (segment && segment.id !== store().playback.currentSegmentId) applySegment(segment);
    if (status !== store().playback.status) store().patchPlayback({ status });
    if (status === "completed") emit("playback:completed");
  },
  onError: (cause) => reportTtsFailure(cause),
});

export async function play(): Promise<void> {
  const state = store();
  if (!state.document) return;
  if (!state.ttsSupported) {
    store().setError(appError("TTS_FAILED"));
    return;
  }
  session.play();
  emit("playback:started");
}

export function pause(): void {
  const before = session.status;
  session.pause();
  if (session.status === before) return;
  emit("playback:paused");
  void persistNow();
}

function isActive(status: string): boolean {
  return status === "playing" || status === "preparing" || status === "buffering";
}

export function togglePlay(): void {
  if (isActive(session.status)) pause();
  else void play();
}

// Moves the narration position. Playing stays playing and paused stays
// paused, the way a skip button behaves; `autoplay` forces a start (a tap on
// the page, a chapter link).
function moveTo(segment: NarrationSegment, origin: MoveOrigin, autoplay?: boolean): void {
  if (autoplay && !store().ttsSupported) {
    store().setError(appError("TTS_FAILED"));
    autoplay = false;
  }
  recordMove(origin, liveSegment(), segment);
  session.seek(segment, { autoplay });
  applySegment(segment);
  void persistNow();
}

export async function seekToSegment(
  segmentId: string,
  options: { keepScrollPosition?: boolean; autoplay?: boolean; origin?: MoveOrigin } = {},
): Promise<void> {
  const segment = findSegment(segmentId);
  if (!segment) return;
  // Starting from a tap resumes auto-follow: the view already shows the
  // tapped page, so following it causes no jump, and from here the pages turn
  // with the narration. (`keepScrollPosition` stays in the signature for
  // callers; the viewer itself now leaves an on-screen page where it is.)
  store().patchViewer({ userScrolling: false, currentPage: segment.page });
  moveTo(segment, options.origin ?? "user:button", options.autoplay ?? true);
}

function skipTo(segment: NarrationSegment): void {
  store().patchViewer({ userScrolling: false, currentPage: segment.page });
  moveTo(segment, "user:button");
}

// The sentence narration is on: the session's own copy (which survives a
// recompile retiring its id), else the stored id.
function liveSegment(): NarrationSegment | null {
  return session.current ?? findSegment(store().playback.currentSegmentId);
}

interface Position {
  all: NarrationSegment[];
  index: number;
  segment: NarrationSegment;
}

// Where narration is in the current reading order, or null when it cannot be
// placed. OWASP A06:2025 Insecure Design - callers stay put on null instead of
// treating an unknown position as the start of the book.
function currentPosition(): Position | null {
  const live = liveSegment();
  const all = orderedSegments();
  const index = indexIn(all, live);
  if (index === null) {
    if (live) recordMove("reconcile", live, null);
    return null;
  }
  return { all, index, segment: all[index]! };
}

function neighbor(direction: -1 | 1): NarrationSegment | null {
  const all = orderedSegments();
  if (all.length === 0) return null;
  if (!liveSegment()) return all[0] ?? null;
  const position = currentPosition();
  if (!position) return null;
  return all[position.index + direction] ?? position.segment;
}

export async function nextSegment(): Promise<void> {
  const position = currentPosition();
  const next = neighbor(1);
  if (next && next !== position?.segment) skipTo(next);
  else if (position) {
    const fallback = await firstSegmentFrom(position.segment.page + 1);
    if (fallback) skipTo(fallback);
  }
}

export async function previousSegment(): Promise<void> {
  const prev = neighbor(-1);
  if (prev) skipTo(prev);
}

export async function nextParagraph(): Promise<void> {
  const position = currentPosition();
  if (!position) return;
  const { all, index: idx, segment: current } = position;
  const next = all.find(
    (segment, index) => index > idx && segment.paragraphId !== current.paragraphId,
  );
  if (next) skipTo(next);
}

export async function previousParagraph(): Promise<void> {
  const position = currentPosition();
  if (!position) return;
  const { all, segment: current } = position;
  let idx = position.index;
  while (idx > 0 && all[idx]?.paragraphId === current.paragraphId) idx -= 1;
  const targetId = all[idx]?.paragraphId;
  while (idx > 0 && all[idx - 1]?.paragraphId === targetId) idx -= 1;
  const target = all[idx];
  if (target) skipTo(target);
}

export function setRate(rate: number): void {
  const next = normalizeRate(rate);
  resetReadAhead();
  store().patchPlayback({ rate: next });
  void persistSettings();
}

export function setVoice(voiceId: string): void {
  resetReadAhead();
  store().patchPlayback({ voiceId });
  emit("voice:changed", { voiceId });
  void persistSettings();
}

export async function setReadingProfile(profileId: BuiltInReadingProfileId): Promise<void> {
  activeReadingProfile = READING_PROFILES[profileId];
  store().setReadingProfileId(profileId);
  const state = store();
  if (state.document) await compileKnownDocument(state.document.model.id);
  await persistSettings();
}

export async function setContentFilters(filters: ContentFilters): Promise<void> {
  store().setContentFilters(filters);
  const state = store();
  if (state.document) await compileKnownDocument(state.document.model.id);
  await persistSettings();
}

export function setSkipInterval(seconds: number): void {
  store().setSkipIntervalSeconds(seconds);
  void persistSettings();
}

export function goToPage(page: number): void {
  const state = store();
  if (!state.document) return;
  const next = Math.min(state.document.model.pageCount, Math.max(1, page));
  store().patchViewer({ currentPage: next, userScrolling: false });
  emit("viewer:pagechanged", { page: next });
  void prefetchAround(next);
}

export function setZoom(zoom: number): void {
  store().patchViewer({ zoom, fitWidth: false });
}

export function setFitWidth(fit: boolean): void {
  store().patchViewer({ fitWidth: fit });
}

export function markUserScrolling(value: boolean): void {
  store().patchViewer({ userScrolling: value });
}

export function returnToNarration(): void {
  const segment = findSegment(store().playback.currentSegmentId);
  store().patchViewer({
    userScrolling: false,
    currentPage: segment?.page ?? store().viewer.currentPage,
  });
}

// A tap between two lines is closer, in raw x/y distance, to whichever box
// happens to be nearest in either direction - which regularly picks a box
// several sentences away over the visually adjacent line, because horizontal
// and vertical gaps get weighed the same. Text stacks vertically, so a tap in
// the gap between lines should resolve by vertical proximity first, and only
// fall back to horizontal distance to break ties within the same line band.
export function closestSegment(
  segments: readonly NarrationSegment[],
  x: number,
  y: number,
): NarrationSegment | null {
  let best: NarrationSegment | null = null;
  let bestKey: [number, number] = [Infinity, Infinity];
  for (const segment of segments) {
    for (const box of segment.bounds) {
      const inside = x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
      const cy = box.y + box.height / 2;
      const cx = box.x + box.width / 2;
      const verticalGap = inside ? 0 : Math.max(0, Math.max(box.y - y, y - (box.y + box.height)));
      const horizontalDist = inside ? 0 : Math.abs(cx - x);
      const key: [number, number] = inside ? [0, 0] : [verticalGap, horizontalDist];
      if (key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
        bestKey = key;
        best = segment;
      }
    }
  }
  return best;
}

export function tapPage(page: number, x: number, y: number): void {
  const segs = segmentsOn(page);
  if (segs.length === 0) {
    goToPage(page);
    return;
  }
  const best = closestSegment(segs, x, y) ?? segs[0]!;
  void seekToSegment(best.id, { keepScrollPosition: true, origin: "user:tap" });
}

// An exact match: the text layer's block id names the precise word the
// reader clicked, so this replaces closestSegment's distance guess whenever
// that id is actually present on the page (a block dropped by a skip policy
// - a header, a footer - has no owning segment, so the caller falls back to
// the geometric guess for those).
// One text-layer block is often a whole printed line shared by two
// sentences, so when a pointer position is known it picks between the
// block's owners by the sentence boxes under it.
export function findSegmentByBlockId(
  segments: readonly NarrationSegment[],
  blockId: string,
  point?: { x: number; y: number },
): NarrationSegment | null {
  const owners = segments.filter((segment) => segment.sourceBlockIds.includes(blockId));
  if (owners.length > 1 && point) return closestSegment(owners, point.x, point.y);
  return owners[0] ?? null;
}

export interface HoverResolution {
  hover: NarrationSegment | null;
  blockId: string | null;
  /** True when no lookup ran because the pointer stayed on the same block id. */
  skipped: boolean;
}

// Backs the pdf-viewer hover highlight. Two things collapse into one
// function because they share the same inputs: skip the owning-segment
// lookup when the pointer hasn't left its last block (the lookup is an
// O(segments) scan on every mouse move otherwise), and drop a stale hover
// that no longer appears in a freshly recompiled `segments` list (the page
// can recompile out from under a hover the pointer hasn't moved off yet).
export function resolveHover({
  segments,
  previousHover,
  previousBlockId,
  blockId,
}: {
  segments: readonly NarrationSegment[];
  previousHover: NarrationSegment | null;
  previousBlockId: string | null;
  blockId: string | null | undefined;
}): HoverResolution {
  const nextBlockId = blockId ?? null;
  if (nextBlockId === null) {
    return { hover: null, blockId: null, skipped: false };
  }
  if (nextBlockId === previousBlockId && previousHover && segments.includes(previousHover)) {
    return { hover: previousHover, blockId: nextBlockId, skipped: true };
  }
  const hover = findSegmentByBlockId(segments, nextBlockId);
  return { hover, blockId: nextBlockId, skipped: false };
}

export function tapBlock(page: number, blockId: string, x: number, y: number): void {
  const segs = segmentsOn(page);
  if (segs.length === 0) {
    goToPage(page);
    return;
  }
  const exact = findSegmentByBlockId(segs, blockId, { x, y });
  const best = exact ?? closestSegment(segs, x, y) ?? segs[0]!;
  void seekToSegment(best.id, { keepScrollPosition: true, origin: "user:tap" });
}

export { cancelRender, renderPage, renderTextLayer, cancelTextLayer };

const sleepTimer = createSleepTimer({
  now: () => Date.now(),
  setTimer: (fn, ms) => window.setTimeout(fn, ms),
  clearTimer: (handle) => window.clearTimeout(handle as number),
  onExpire: () => {
    pause();
    store().setSleepTimer({ mode: "off", endsAt: null });
    store().setNotice("Sleep timer ended - narration paused.");
  },
});

export function setSleepTimer(choice: number | "end-of-chapter" | "off"): void {
  if (choice === "off") {
    sleepTimer.cancel();
    store().setSleepTimer({ mode: "off", endsAt: null });
  } else if (choice === "end-of-chapter") {
    sleepTimer.stopAtChapterEnd();
    store().setSleepTimer({ mode: "end-of-chapter", endsAt: null });
  } else {
    sleepTimer.start(choice);
    store().setSleepTimer({ mode: "timed", endsAt: Date.now() + choice * 60_000 });
  }
}

/** Audible-style skip by the configured interval; -1 goes back. */
export function skipInterval(direction: -1 | 1): void {
  const position = currentPosition();
  if (!position) return;
  const { all, index } = position;
  const seconds = store().skipIntervalSeconds * direction;
  const target = all[skipTarget(all, index, seconds, store().playback.rate)];
  if (target) skipTo(target);
}

export function skipChapter(direction: -1 | 1): void {
  const position = currentPosition();
  if (!position) return;
  const { all } = position;
  const index = chapterTarget(all, position.index, direction);
  const target = index === null ? null : all[index];
  if (target) skipTo(target);
}

export function addBookmarkHere(note = ""): void {
  const state = store();
  const position = currentPosition();
  if (!state.document || !position) return;
  const { segment } = position;
  const bookmarks = addBookmark(state.bookmarks, {
    segmentId: segment.id,
    order: position.index,
    page: segment.page,
    excerpt: segment.originalText,
    note,
    createdAt: Date.now(),
  });
  store().setBookmarks(bookmarks);
  void saveBookmarks(state.document.model.id, bookmarks);
}

export function removeBookmark(segmentId: string): void {
  const state = store();
  if (!state.document) return;
  const bookmarks = state.bookmarks.filter((mark) => mark.segmentId !== segmentId);
  store().setBookmarks(bookmarks);
  void saveBookmarks(state.document.model.id, bookmarks);
}

export function goToBookmark(segmentId: string): void {
  const segment = findSegment(segmentId);
  if (segment) skipTo(segment);
}
