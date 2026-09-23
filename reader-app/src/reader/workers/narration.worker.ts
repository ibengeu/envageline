import type { DocumentBlock, DocumentHints, ExtractedPage } from "../core/types.ts";
import { compilePage } from "../narration/compiler.ts";

export type WorkerRequest = {
  type: "PROCESS_PAGE";
  payload: {
    documentId: string;
    page: number;
    width: number;
    height: number;
    blocks: DocumentBlock[];
    scanned: boolean;
    textLength: number;
    hints: DocumentHints;
  };
};

export type WorkerResponse =
  | {
      type: "PAGE_PROCESSED";
      payload: {
        page: number;
        segments: ReturnType<typeof compilePage>["segments"];
        hints: DocumentHints;
      };
    }
  | {
      type: "PAGE_FAILED";
      payload: { page: number; message: string };
    };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const data = event.data;
  if (data.type !== "PROCESS_PAGE") return;
  try {
    const page: ExtractedPage = {
      documentId: data.payload.documentId,
      page: data.payload.page,
      width: data.payload.width,
      height: data.payload.height,
      blocks: data.payload.blocks,
      scanned: data.payload.scanned,
      textLength: data.payload.textLength,
    };
    const result = compilePage(page, data.payload.hints);
    const response: WorkerResponse = {
      type: "PAGE_PROCESSED",
      payload: {
        page: data.payload.page,
        segments: result.segments,
        hints: result.hints,
      },
    };
    self.postMessage(response);
  } catch (cause) {
    const response: WorkerResponse = {
      type: "PAGE_FAILED",
      payload: {
        page: data.payload.page,
        message: cause instanceof Error ? cause.message : "Narration failed",
      },
    };
    self.postMessage(response);
  }
};
