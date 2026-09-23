import { create } from "zustand";
import { DEFAULT_RATE } from "./config.ts";
import { DEFAULT_CONTENT_FILTERS, type ContentFilters } from "../narration/reading-profile.ts";
import type { Bookmark } from "../playback/bookmarks.ts";
import type { SleepTimerMode } from "../playback/sleep-timer.ts";

export interface SleepTimerState {
  mode: SleepTimerMode;
  endsAt: number | null;
}
import type {
  AppError,
  BuiltInReadingProfileId,
  DocumentSlice,
  NarrationSegment,
  PlaybackSlice,
  ProcessingSlice,
  ProcessingState,
  RecentDocument,
  ViewerState,
} from "./types.ts";

export interface ReaderStore {
  document: DocumentSlice | null;
  recents: RecentDocument[];
  viewer: ViewerState;
  playback: PlaybackSlice;
  processing: ProcessingSlice;
  segmentsByPage: Record<number, NarrationSegment[]>;
  error: AppError | null;
  notice: string | null;
  sidebarOpen: boolean;
  settingsOpen: boolean;
  playerMinimized: boolean;
  ttsSupported: boolean;
  hydrated: boolean;
  readingProfileId: BuiltInReadingProfileId;
  contentFilters: ContentFilters;
  skipIntervalSeconds: number;
  bookmarks: Bookmark[];
  sleepTimer: SleepTimerState;

  setBookmarks: (value: Bookmark[]) => void;
  setSleepTimer: (value: SleepTimerState) => void;
  setContentFilters: (value: ContentFilters) => void;
  setSkipIntervalSeconds: (value: number) => void;
  setHydrated: (value: boolean) => void;
  setReadingProfileId: (value: BuiltInReadingProfileId) => void;
  setRecents: (recents: RecentDocument[]) => void;
  setDocument: (document: DocumentSlice | null) => void;
  patchViewer: (patch: Partial<ViewerState>) => void;
  patchPlayback: (patch: Partial<PlaybackSlice>) => void;
  setPageState: (page: number, state: ProcessingState) => void;
  setQueued: (pages: number[]) => void;
  setActivePage: (page: number | null) => void;
  setSegments: (page: number, segments: NarrationSegment[]) => void;
  resetDocumentState: () => void;
  setError: (error: AppError | null) => void;
  setNotice: (notice: string | null) => void;
  setSidebarOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setPlayerMinimized: (minimized: boolean) => void;
  setTtsSupported: (value: boolean) => void;
}

const initialViewer: ViewerState = {
  currentPage: 1,
  zoom: 1,
  fitWidth: true,
  userScrolling: false,
};

const initialPlayback: PlaybackSlice = {
  status: "idle",
  currentSegmentId: null,
  currentSegmentIndex: 0,
  rate: DEFAULT_RATE,
  voiceId: null,
  voices: [],
};

const initialProcessing: ProcessingSlice = {
  activePage: null,
  queuedPages: [],
  pageStates: {},
};

export const useReaderStore = create<ReaderStore>((set) => ({
  document: null,
  recents: [],
  viewer: initialViewer,
  playback: initialPlayback,
  processing: initialProcessing,
  segmentsByPage: {},
  error: null,
  notice: null,
  sidebarOpen: true,
  settingsOpen: false,
  playerMinimized: false,
  ttsSupported: true,
  hydrated: false,
  readingProfileId: "audiobook",
  contentFilters: { ...DEFAULT_CONTENT_FILTERS },
  skipIntervalSeconds: 30,
  bookmarks: [],
  sleepTimer: { mode: "off", endsAt: null },

  setBookmarks: (bookmarks) => set({ bookmarks }),
  setSleepTimer: (sleepTimer) => set({ sleepTimer }),
  setContentFilters: (contentFilters) => set({ contentFilters }),
  setSkipIntervalSeconds: (skipIntervalSeconds) => set({ skipIntervalSeconds }),
  setHydrated: (hydrated) => set({ hydrated }),
  setReadingProfileId: (readingProfileId) => set({ readingProfileId }),
  setRecents: (recents) => set({ recents }),
  setDocument: (document) => set({ document }),
  patchViewer: (patch) =>
    set((state) => ({ viewer: { ...state.viewer, ...patch } })),
  patchPlayback: (patch) =>
    set((state) => ({ playback: { ...state.playback, ...patch } })),
  setPageState: (page, pageState) =>
    set((state) => ({
      processing: {
        ...state.processing,
        pageStates: { ...state.processing.pageStates, [page]: pageState },
      },
    })),
  setQueued: (queuedPages) =>
    set((state) => ({ processing: { ...state.processing, queuedPages } })),
  setActivePage: (activePage) =>
    set((state) => ({ processing: { ...state.processing, activePage } })),
  setSegments: (page, segments) =>
    set((state) => ({
      segmentsByPage: { ...state.segmentsByPage, [page]: segments },
    })),
  resetDocumentState: () =>
    set({
      document: null,
      viewer: initialViewer,
      playback: {
        ...useReaderStore.getState().playback,
        status: "idle",
        currentSegmentId: null,
        currentSegmentIndex: 0,
      },
      processing: initialProcessing,
      segmentsByPage: {},
      bookmarks: [],
      error: null,
      notice: null,
    }),
  setError: (error) => set({ error }),
  setNotice: (notice) => set({ notice }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setPlayerMinimized: (playerMinimized) => set({ playerMinimized }),
  setTtsSupported: (ttsSupported) => set({ ttsSupported }),
}));

export function allSegments(): NarrationSegment[] {
  const { document, segmentsByPage } = useReaderStore.getState();
  if (!document) return [];
  const list: NarrationSegment[] = [];
  for (let page = 1; page <= document.model.pageCount; page += 1) {
    const segs = segmentsByPage[page];
    if (segs) list.push(...segs);
  }
  return list;
}

export function currentSegment(): NarrationSegment | null {
  const { playback } = useReaderStore.getState();
  const segments = allSegments();
  return (
    segments.find((segment) => segment.id === playback.currentSegmentId) ??
    segments[playback.currentSegmentIndex] ??
    null
  );
}
