import {
  DB_NAME,
  DB_VERSION,
  MAX_CACHED_BYTES,
  MAX_CACHED_DOCUMENTS,
  PROCESSING_VERSION,
} from "../core/config.ts";
import { logError } from "../core/errors.ts";
import { DEFAULT_SETTINGS, sanitizeSettings } from "./settings.ts";
import { addBookmark, type Bookmark } from "../playback/bookmarks.ts";
import type {
  DocumentHints,
  NarrationSegment,
  ReaderSettings,
  ReadingProgress,
  StoredDocument,
} from "../core/types.ts";


function available(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("documents")) {
        db.createObjectStore("documents", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("files")) {
        db.createObjectStore("files", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("segments")) {
        db.createObjectStore("segments", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("progress")) {
        db.createObjectStore("progress", { keyPath: "documentId" });
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("bookmarks")) {
        db.createObjectStore("bookmarks", { keyPath: "documentId" });
      }
      if (!db.objectStoreNames.contains("hints")) {
        db.createObjectStore("hints", { keyPath: "documentId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  try {
    const tx = db.transaction(store, mode);
    const objectStore = tx.objectStore(store);
    const result = await fn(objectStore);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return result;
  } finally {
    db.close();
  }
}

export async function saveDocumentMeta(doc: StoredDocument): Promise<void> {
  if (!available()) return;
  try {
    await withStore("documents", "readwrite", (store) => req(store.put(doc)));
    await evictIfNeeded();
  } catch (cause) {
    logError("STORAGE_FAILED", cause);
  }
}

export async function saveDocumentFile(id: string, blob: Blob): Promise<void> {
  if (!available()) return;
  try {
    await withStore("files", "readwrite", (store) => req(store.put({ id, blob })));
  } catch (cause) {
    logError("STORAGE_FAILED", cause);
  }
}

export async function getDocumentFile(id: string): Promise<Blob | null> {
  if (!available()) return null;
  try {
    const row = await withStore<{ id: string; blob: Blob } | undefined>(
      "files",
      "readonly",
      (store) => req(store.get(id)),
    );
    return row?.blob ?? null;
  } catch {
    return null;
  }
}

export async function listDocuments(): Promise<StoredDocument[]> {
  if (!available()) return [];
  try {
    const rows = await withStore<StoredDocument[]>(
      "documents",
      "readonly",
      (store) => req(store.getAll()),
    );
    return rows.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  } catch {
    return [];
  }
}

export async function saveSegments(
  documentId: string,
  page: number,
  segments: NarrationSegment[],
): Promise<void> {
  if (!available()) return;
  try {
    await withStore("segments", "readwrite", (store) =>
      req(
        store.put({
          key: `${documentId}:${page}`,
          documentId,
          page,
          processingVersion: PROCESSING_VERSION,
          segments,
        }),
      ),
    );
  } catch (cause) {
    logError("STORAGE_FAILED", cause);
  }
}

export async function getSegments(
  documentId: string,
  page: number,
): Promise<NarrationSegment[] | null> {
  if (!available()) return null;
  try {
    const row = await withStore<{
      processingVersion: number;
      segments: NarrationSegment[];
    } | undefined>("segments", "readonly", (store) =>
      req(store.get(`${documentId}:${page}`)),
    );
    if (!row || row.processingVersion !== PROCESSING_VERSION) return null;
    return row.segments;
  } catch {
    return null;
  }
}

export async function saveProgress(progress: ReadingProgress): Promise<void> {
  if (!available()) return;
  try {
    await withStore("progress", "readwrite", (store) => req(store.put(progress)));
  } catch (cause) {
    logError("STORAGE_FAILED", cause);
  }
}

export async function getProgress(
  documentId: string,
): Promise<ReadingProgress | null> {
  if (!available()) return null;
  try {
    const row = await withStore<ReadingProgress | undefined>(
      "progress",
      "readonly",
      (store) => req(store.get(documentId)),
    );
    return row ?? null;
  } catch {
    return null;
  }
}

export async function saveSettings(settings: ReaderSettings): Promise<void> {
  if (!available()) return;
  try {
    await withStore("settings", "readwrite", (store) =>
      req(store.put({ id: "user", ...settings })),
    );
  } catch (cause) {
    logError("STORAGE_FAILED", cause);
  }
}

export async function loadSettings(): Promise<ReaderSettings> {
  if (!available()) return { ...DEFAULT_SETTINGS };
  try {
    const row = await withStore<(ReaderSettings & { id: string }) | undefined>(
      "settings",
      "readonly",
      (store) => req(store.get("user")),
    );
    return sanitizeSettings(row);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveHints(
  documentId: string,
  hints: DocumentHints,
): Promise<void> {
  if (!available()) return;
  try {
    await withStore("hints", "readwrite", (store) =>
      req(store.put({ documentId, ...hints })),
    );
  } catch {
    /* ignore */
  }
}

export async function loadHints(documentId: string): Promise<DocumentHints> {
  const empty: DocumentHints = { headerTexts: [], footerTexts: [], lastHeading: null };
  if (!available()) return empty;
  try {
    const row = await withStore<
      (DocumentHints & { documentId: string }) | undefined
    >("hints", "readonly", (store) => req(store.get(documentId)));
    return {
      headerTexts: row?.headerTexts ?? [],
      footerTexts: row?.footerTexts ?? [],
      lastHeading: row?.lastHeading ?? null,
    };
  } catch {
    return empty;
  }
}

async function evictIfNeeded(): Promise<void> {
  const docs = await listDocuments();
  let bytes = docs.reduce((sum, doc) => sum + (doc.byteLength || 0), 0);
  const overflow = docs.slice(MAX_CACHED_DOCUMENTS);
  const toDelete = [...overflow];
  for (const doc of docs.slice().sort((a, b) => a.lastOpenedAt - b.lastOpenedAt)) {
    if (bytes <= MAX_CACHED_BYTES && toDelete.length === 0) break;
    if (overflow.includes(doc)) continue;
    if (bytes > MAX_CACHED_BYTES) {
      toDelete.push(doc);
      bytes -= doc.byteLength || 0;
    }
  }
  for (const doc of toDelete) {
    await deleteDocument(doc.id);
  }
}

export async function deleteDocument(id: string): Promise<void> {
  if (!available()) return;
  try {
    const db = await openDb();
    const tx = db.transaction(
      ["documents", "files", "segments", "progress", "hints"],
      "readwrite",
    );
    tx.objectStore("documents").delete(id);
    tx.objectStore("files").delete(id);
    tx.objectStore("progress").delete(id);
    tx.objectStore("hints").delete(id);
    const segments = tx.objectStore("segments");
    const cursorReq = segments.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      const value = cursor.value as { documentId?: string };
      if (value.documentId === id) cursor.delete();
      cursor.continue();
    };
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (cause) {
    logError("STORAGE_FAILED", cause);
  }
}

export async function saveBookmarks(documentId: string, bookmarks: Bookmark[]): Promise<void> {
  if (!available()) return;
  try {
    await withStore("bookmarks", "readwrite", (store) => req(store.put({ documentId, bookmarks })));
  } catch (cause) {
    logError("STORAGE_FAILED", cause);
  }
}

function storedBookmark(value: unknown): Bookmark | null {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!row || typeof row.segmentId !== "string" || row.segmentId.length > 300) return null;
  const number = (field: unknown) => (typeof field === "number" && Number.isFinite(field) ? field : 0);
  return {
    segmentId: row.segmentId,
    order: number(row.order),
    page: number(row.page),
    excerpt: typeof row.excerpt === "string" ? row.excerpt : "",
    note: typeof row.note === "string" ? row.note : "",
    createdAt: number(row.createdAt),
  };
}

// OWASP A08:2025 Software or Data Integrity Failures - stored bookmarks are
// re-validated and re-sanitized on the way back in.
export async function loadBookmarks(documentId: string): Promise<Bookmark[]> {
  if (!available()) return [];
  try {
    const row = await withStore<{ bookmarks?: unknown } | undefined>("bookmarks", "readonly", (store) =>
      req(store.get(documentId)),
    );
    const rows = Array.isArray(row?.bookmarks) ? row.bookmarks : [];
    return rows.reduce<Bookmark[]>((list, value) => {
      const mark = storedBookmark(value);
      return mark ? addBookmark(list, mark) : list;
    }, []);
  } catch {
    return [];
  }
}
