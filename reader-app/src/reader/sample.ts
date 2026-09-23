import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const INK = rgb(0.08, 0.08, 0.09);
const MUTED = rgb(0.35, 0.34, 0.32);
const RULE = rgb(0.78, 0.76, 0.72);

function wrap(text: string, font: { widthOfTextAtSize: (t: string, s: number) => number }, size: number, max: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > max && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function createSamplePdf(): Promise<File> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("The Shape of Spoken Documents");
  pdf.setAuthor("Auralis");
  pdf.setSubject("A sample essay for on-device PDF listening");
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const serifBold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const pageWidth = 612;
  const pageHeight = 792;
  const left = 64;
  const width = pageWidth - 128;

  const pages = [pdf.addPage([pageWidth, pageHeight]), pdf.addPage([pageWidth, pageHeight]), pdf.addPage([pageWidth, pageHeight]), pdf.addPage([pageWidth, pageHeight])];

  const header = (page: (typeof pages)[0], number: number) => {
    page.drawText("AURALIS  ·  SAMPLE ESSAY", {
      x: left,
      y: pageHeight - 42,
      size: 9,
      font: sans,
      color: MUTED,
    });
    page.drawLine({
      start: { x: left, y: pageHeight - 52 },
      end: { x: pageWidth - left, y: pageHeight - 52 },
      thickness: 0.4,
      color: RULE,
    });
    page.drawText(String(number), {
      x: pageWidth / 2 - 4,
      y: 36,
      size: 10,
      font: sans,
      color: MUTED,
    });
  };

  const drawParagraphs = (
    page: (typeof pages)[0],
    startY: number,
    paragraphs: string[],
    size = 12,
  ) => {
    let y = startY;
    const leading = size + 6;
    for (const para of paragraphs) {
      const lines = wrap(para, serif, size, width);
      for (const line of lines) {
        if (y < 64) return y;
        page.drawText(line, { x: left, y, size, font: serif, color: INK });
        y -= leading;
      }
      y -= 10;
    }
    return y;
  };

  header(pages[0]!, 1);
  pages[0]!.drawText("The Shape of Spoken Documents", {
    x: left,
    y: pageHeight - 120,
    size: 26,
    font: serifBold,
    color: INK,
  });
  pages[0]!.drawText("A short essay on reading order, cleanup, and time-to-first-speech.", {
    x: left,
    y: pageHeight - 150,
    size: 12,
    font: serif,
    color: MUTED,
  });
  drawParagraphs(pages[0]!, pageHeight - 190, [
    "Documents were never written to be heard. A page is a map of attention: columns, headings, running headers, and the quiet machinery of citations [12]. When we ask a machine to read that map aloud, the first problem is not voice quality. It is sequence.",
    "Dr. Rivera has argued that a 500-page report should not require 500 pages of preprocessing before the first sentence is spoken (Smith, 2024). The company that shipped the prototype reported $12.4M in Q3, a 23.7% YoY gain, while still keeping the entire pipeline on-device.",
    "This sample is designed to exercise that pipeline. You should hear the body of the essay, not the running header, not the page number, and not the bracketed references. Currency, percentages, and titles should sound like speech rather than typography.",
    "If you clicked into this document from Auralis, press play. The highlight will follow each sentence. Skip forward. Change the voice. The next pages are already being prepared while you listen.",
  ]);

  header(pages[1]!, 2);
  pages[1]!.drawText("From layout to speech", {
    x: left,
    y: pageHeight - 88,
    size: 18,
    font: serifBold,
    color: INK,
  });
  drawParagraphs(pages[1]!, pageHeight - 120, [
    "A PDF stores visual objects, not paragraphs. The extractor returns fragments. The narration compiler groups those fragments into lines, then into paragraphs, then into sentences that a speech engine can accept without swallowing an entire page at once.",
    "Hyphenation is a small, stubborn problem. A line ending in inter- followed by national should become international. A line ending in state- followed by of-the-art must remain state-of-the-art. The rule is conservative on purpose.",
    "Lists are another kind of music. They should not say the word bullet. They should pause, then count.",
  ]);
  const list = [
    "1. Open a PDF from your computer.",
    "2. Press play on the current page.",
    "3. Follow the highlight, or tap a paragraph to jump.",
  ];
  let listY = 430;
  for (const item of list) {
    pages[1]!.drawText(item, { x: left + 18, y: listY, size: 12, font: serif, color: INK });
    listY -= 22;
  }
  drawParagraphs(pages[1]!, listY - 12, [
    "Units are expanded when the meaning is stable: 5 km becomes five kilometers. The CPU is spelled letter by letter, while NASA stays a word. Abbreviations such as e.g. and i.e. are spoken in full so they do not fracture a sentence.",
    "None of this work should leave the browser. The file, the extracted text, and the reading position remain on this device. That is not a slogan. It is the architecture.",
  ]);

  header(pages[2]!, 3);
  pages[2]!.drawText("Two columns, one voice", {
    x: left,
    y: pageHeight - 88,
    size: 18,
    font: serifBold,
    color: INK,
  });

  const colWidth = 220;
  const leftCol = [
    "Reading order is the difference between a document and a jumble. Scientific papers often place two arguments side by side. A naive extractor reads across the gutter and produces nonsense.",
    "Auralis clusters text by column, then reads the left column completely before the right. Alpha one. Alpha two. Then beta. The highlight still sits on the geometry of the page, so your eye can follow even when the voice has moved to another region.",
    "The same reconstruction is used for magazines, annual reports, and manuals. When the gutter is unclear, the compiler falls back to simple top-to-bottom order rather than inventing structure.",
  ];
  const rightCol = [
    "Why start so quickly? Because listening is a continuous act. If the first sentence is ready, playback can begin while page four is still being cleaned.",
    "Background work uses a priority window: the current page, then the next two, then whatever the CPU can spare. If processing outruns playback, the window grows. If the machine is busy, it shrinks.",
    "You can leave and return. Progress is stored with the document identity, a SHA-256 of the file itself, so the same PDF resumes in the same place even if you renamed it.",
  ];

  const drawCol = (lines: string[], x: number, startY: number) => {
    let y = startY;
    for (const para of lines) {
      const wrapped = wrap(para, serif, 11, colWidth);
      for (const line of wrapped) {
        pages[2]!.drawText(line, { x, y, size: 11, font: serif, color: INK });
        y -= 15;
      }
      y -= 10;
    }
  };
  drawCol(leftCol, left, pageHeight - 130);
  drawCol(rightCol, left + 248, pageHeight - 130);

  header(pages[3]!, 4);
  pages[3]!.drawText("A closing note", {
    x: left,
    y: pageHeight - 88,
    size: 18,
    font: serifBold,
    color: INK,
  });
  drawParagraphs(pages[3]!, pageHeight - 120, [
    "If this page is being read aloud, the experiment worked. Headers were skipped. Page numbers were skipped. Citations were removed from speech but not from the original text, which remains available for highlighting and search.",
    "Future versions may add on-device OCR for scanned pages, local neural voices, and chapter detection. None of those features should require a rewrite of the interface, the PDF engine, or the speech engine. The seams are intentional.",
    "Until then: open another document. Auralis will start talking as soon as the current page is ready.",
  ]);
  pages[3]!.drawText("References", {
    x: left,
    y: 280,
    size: 16,
    font: serifBold,
    color: INK,
  });
  drawParagraphs(pages[3]!, 250, [
    "Smith, A. (2024). Time to first speech in document narration. Journal of Imagined Results, 12, 1-9.",
    "Rivera, L. (2023). Columns, gutters, and the myth of reading order. Proceedings of Layout, 4, 88-101.",
  ]);

  const bytes = await pdf.save();
  const copy = new Uint8Array(bytes);
  const blob = new Blob([copy], { type: "application/pdf" });
  return new File([blob], "auralis-sample-essay.pdf", { type: "application/pdf" });
}
