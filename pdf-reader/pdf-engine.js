import * as pdfjsLib from "./vendor/pdfjs-4.10.38/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs-4.10.38/pdf.worker.min.mjs";
globalThis.pdfjsLib = pdfjsLib;
