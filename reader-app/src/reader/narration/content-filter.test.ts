import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DocumentBlock, ExtractedPage } from "../core/types.ts";
import { compileDocument } from "./compiler.ts";
import {
  AUDIOBOOK_READING_PROFILE,
  DEFAULT_CONTENT_FILTERS,
  withContentFilters,
} from "./reading-profile.ts";

const BODY = 0.018;
const HEADING = 0.028;

function text(id: string, value: string, y: number, fontSize = BODY, page = 1): DocumentBlock {
  return {
    id,
    page,
    text: value,
    bounds: { x: 0.12, y, width: 0.76, height: fontSize * 1.4 },
    fontSize,
    source: "pdf-text",
  };
}

function page(number: number, blocks: DocumentBlock[]): ExtractedPage {
  return {
    documentId: "novel",
    page: number,
    width: 600,
    height: 800,
    scanned: false,
    textLength: blocks.reduce((sum, block) => sum + block.text.length, 0),
    blocks: blocks.map((block) => ({ ...block, page: number })),
  };
}

function narration(pages: ExtractedPage[]): string {
  return compileDocument(pages).segments.map((segment) => segment.spokenText).join(" ");
}

const chapterOne = page(3, [
  text("ch1", "Chapter One", 0.2, HEADING),
  text("ch1-body", "The rain had not stopped for three days when the letter came.", 0.3),
  text("ch1-body-2", "Nobody in the house would open it before breakfast.", 0.4),
  text("ch1-body-3", "So it waited on the table, propped against the teapot.", 0.5),
]);

describe("content filtering", () => {
  it("skips a publisher's note but still reads the chapter that follows", () => {
    const note = page(2, [
      text("note-h", "A Note from the Publisher", 0.2, HEADING),
      text("note-1", "We are delighted to bring you this edition, and we hope you enjoy it.", 0.3),
      text("note-2", "Sign up for our newsletter to hear about new releases and offers.", 0.36),
    ]);

    const spoken = narration([note, chapterOne]);

    assert.doesNotMatch(spoken, /Publisher|delighted|newsletter/);
    assert.match(spoken, /Chapter One/);
    assert.match(spoken, /The rain had not stopped/);
  });

  it("skips a table of contents", () => {
    const contents = page(2, [
      text("toc-h", "Contents", 0.2, HEADING),
      text("toc-1", "Chapter One . . . . . . . . 3", 0.3),
      text("toc-2", "Chapter Two . . . . . . . . 17", 0.34),
      text("toc-3", "Acknowledgments . . . . . . 301", 0.38),
    ]);

    const spoken = narration([contents, chapterOne]);

    assert.doesNotMatch(spoken, /Contents|Chapter Two|Acknowledgments/);
    assert.match(spoken, /The rain had not stopped/);
  });

  it("skips a contents listing even when it has no heading of its own", () => {
    const listing = page(2, [
      text("nav-1", "Chapter One 3", 0.3),
      text("nav-2", "The Harbour 17", 0.34),
      text("nav-3", "Letters Home 41", 0.38),
      text("nav-4", "Epilogue 288", 0.42),
    ]);

    const spoken = narration([listing, chapterOne]);

    assert.doesNotMatch(spoken, /Harbour|Letters Home|Epilogue/);
    assert.match(spoken, /The rain had not stopped/);
  });

  it("skips a copyright page, including its work-of-fiction legal notice", () => {
    const imprint = page(2, [
      text("cr-1", "Copyright © 2021 by Jane Doe", 0.3),
      text("cr-2", "All rights reserved.", 0.38),
      text(
        "cr-3",
        "This is a work of fiction. Names, characters, places, and incidents are products of the author's imagination.",
        0.46,
      ),
      text("cr-4", "ISBN 978-0-00-000000-0", 0.54),
      text("cr-5", "Printed in the United States of America", 0.62),
    ]);

    const spoken = narration([imprint, chapterOne]);

    assert.doesNotMatch(spoken, /Copyright|rights reserved|work of fiction|ISBN|Printed in/);
    assert.match(spoken, /The rain had not stopped/);
  });

  it("skips back matter such as the author biography after the story ends", () => {
    const about = page(4, [
      text("ab-h", "About the Author", 0.2, HEADING),
      text("ab-1", "Jane Doe lives in Maine with her two dogs and far too many books.", 0.3),
    ]);

    const spoken = narration([chapterOne, about]);

    assert.match(spoken, /The rain had not stopped/);
    assert.doesNotMatch(spoken, /About the Author|two dogs/);
  });

  it("still reads an introduction that follows the contents", () => {
    const contents = page(1, [
      text("toc-h", "Contents", 0.2, HEADING),
      text("toc-1", "Introduction . . . . . . . . 2", 0.3),
    ]);
    const introduction = page(2, [
      text("intro-h", "Introduction", 0.2, HEADING),
      text("intro-1", "This book began as a series of letters written during the war.", 0.3),
      text("intro-2", "Most of them were never sent.", 0.4),
    ]);

    const spoken = narration([contents, introduction, chapterOne]);

    assert.match(spoken, /This book began as a series of letters/);
    assert.match(spoken, /The rain had not stopped/);
  });

  it("never lets a matter section swallow the book when no heading follows it", () => {
    const note = page(1, [
      text("pn-h", "A Note from the Publisher", 0.2, HEADING),
      text("pn-1", "We hope you enjoy this edition.", 0.3),
    ]);
    const story = [2, 3, 4, 5, 6, 7].map((number) =>
      page(number, [
        text(`s${number}-a`, `Page ${number} of the story carried the voyage further north.`, 0.3),
        text(`s${number}-b`, "The crew said little and watched the ice.", 0.4),
      ]),
    );

    const spoken = narration([note, ...story]);

    assert.doesNotMatch(spoken, /enjoy this edition/);
    assert.match(spoken, /Page 2 of the story/);
    assert.match(spoken, /Page 7 of the story/);
  });

  it("reads a publisher's note when the listener turns that filter off", () => {
    const note = page(2, [
      text("note-h", "A Note from the Publisher", 0.2, HEADING),
      text("note-1", "We are delighted to bring you this edition.", 0.3),
    ]);
    const profile = withContentFilters(AUDIOBOOK_READING_PROFILE, {
      ...DEFAULT_CONTENT_FILTERS,
      skipPublisherMatter: false,
    });

    const spoken = compileDocument([note, chapterOne], profile).segments
      .map((segment) => segment.spokenText)
      .join(" ");

    assert.match(spoken, /delighted to bring you this edition/);
  });

  it("leaves footnotes out by default and reads them when the listener asks", () => {
    const annotated = page(3, [
      ...chapterOne.blocks,
      text("fn-1", "1 The letter was dated the winter of 1911.", 0.9, 0.012),
    ]);
    const withFootnotes = withContentFilters(AUDIOBOOK_READING_PROFILE, {
      ...DEFAULT_CONTENT_FILTERS,
      footnotes: "read",
    });
    const read = (profile = AUDIOBOOK_READING_PROFILE) =>
      compileDocument([annotated], profile).segments.map((segment) => segment.spokenText).join(" ");

    assert.doesNotMatch(read(), /winter of/);
    assert.match(read(withFootnotes), /winter of/);
  });

  it("reads running headers only when the listener turns that filter off", () => {
    const pages = [5, 6, 7].map((number) =>
      page(number, [
        text(`hd-${number}`, "THE LONG WINTER", 0.04, 0.014),
        text(`bd-${number}`, `Snow fell again on day ${number} and the roads closed.`, 0.3),
        text(`bd2-${number}`, "Everyone stayed inside and waited for news.", 0.4),
      ]),
    );
    const keepHeaders = withContentFilters(AUDIOBOOK_READING_PROFILE, {
      ...DEFAULT_CONTENT_FILTERS,
      skipRunningText: false,
    });
    const read = (profile = AUDIOBOOK_READING_PROFILE) =>
      compileDocument(pages, profile).segments.map((segment) => segment.spokenText).join(" ");

    assert.doesNotMatch(read(), /LONG WINTER/i);
    assert.match(read(keepHeaders), /LONG WINTER/i);
  });

  it("reads inline source markers only when references are not skipped", () => {
    const cited = page(3, [
      ...chapterOne.blocks,
      text("cite-1", "The storm of that year is well recorded [12].", 0.6),
    ]);
    const keepReferences = withContentFilters(AUDIOBOOK_READING_PROFILE, {
      ...DEFAULT_CONTENT_FILTERS,
      skipReferences: false,
    });
    const read = (profile = AUDIOBOOK_READING_PROFILE) =>
      compileDocument([cited], profile).segments.map((segment) => segment.originalText).join(" ");

    assert.doesNotMatch(read(), /\[12\]/);
    assert.match(read(keepReferences), /\[12\]/);
  });
});
