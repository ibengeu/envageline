import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDeliberateTap, shouldHandleShortcut } from "./input-guards.ts";

const plainTap = { selectedText: "", travelPx: 1, pressMs: 120, msSinceWindowFocus: 60_000 };

describe("telling a tap on a sentence from other clicks on the page", () => {
  it("treats a short, still tap with nothing selected as a request to read from there", () => {
    assert.equal(isDeliberateTap(plainTap), true);
  });

  it("ignores the click that ends selecting text to copy", () => {
    assert.equal(isDeliberateTap({ ...plainTap, selectedText: "net revenue rose" }), false);
  });

  it("ignores a press that dragged across the page", () => {
    assert.equal(isDeliberateTap({ ...plainTap, travelPx: 24 }), false);
  });

  it("ignores a long press, such as holding while reading a line", () => {
    assert.equal(isDeliberateTap({ ...plainTap, pressMs: 900 }), false);
  });

  it("ignores the click that only brought the window back to the front", () => {
    assert.equal(isDeliberateTap({ ...plainTap, msSinceWindowFocus: 80 }), false);
  });
});

const onPage = { tagName: "DIV", isContentEditable: false, role: null, defaultPrevented: false };

describe("deciding whether a key press is a narration shortcut", () => {
  it("handles a shortcut pressed while reading the page", () => {
    assert.equal(shouldHandleShortcut(onPage), true);
  });

  it("leaves keys alone while the listener is typing", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
      assert.equal(shouldHandleShortcut({ ...onPage, tagName }), false, tagName);
    }
    assert.equal(shouldHandleShortcut({ ...onPage, isContentEditable: true }), false);
  });

  it("leaves arrow keys to controls that use them, such as the speed slider", () => {
    for (const role of ["slider", "listbox", "radiogroup", "menu", "menuitem", "tab", "spinbutton", "combobox"]) {
      assert.equal(shouldHandleShortcut({ ...onPage, tagName: "SPAN", role }), false, role);
    }
  });

  it("does not act on a key another control already handled", () => {
    assert.equal(shouldHandleShortcut({ ...onPage, defaultPrevented: true }), false);
  });
});
