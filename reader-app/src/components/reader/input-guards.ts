export interface TapFacts {
  selectedText: string;
  travelPx: number;
  pressMs: number;
  msSinceWindowFocus: number;
}

// Pointer travel beyond this is a drag or a scroll, not a tap.
const MAX_TRAVEL_PX = 6;
// Held longer than this, the listener was resting on the page, not tapping.
const MAX_PRESS_MS = 500;
// A click this soon after the window gained focus was switching to the app.
const MIN_MS_SINCE_FOCUS = 300;

// Whether a click on a page asked to read from there. Seeking also starts
// playback, so anything that was really a selection, drag, long press or
// window switch must not move the narration.
export function isDeliberateTap(facts: TapFacts): boolean {
  if (facts.selectedText.trim() !== "") return false;
  if (facts.msSinceWindowFocus < MIN_MS_SINCE_FOCUS) return false;
  return facts.travelPx <= MAX_TRAVEL_PX && facts.pressMs <= MAX_PRESS_MS;
}

export interface KeyTargetFacts {
  tagName: string;
  isContentEditable: boolean;
  role: string | null;
  defaultPrevented: boolean;
}

const TEXT_ENTRY_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
// Widgets whose own keyboard behaviour includes the arrow keys.
const KEY_OWNING_ROLES = new Set([
  "slider",
  "listbox",
  "radiogroup",
  "menu",
  "menuitem",
  "tab",
  "spinbutton",
  "combobox",
]);

// Whether a key press should drive narration: never while the listener is
// typing or working a control that owns those keys, or the arrow that nudges
// the speed slider would also skip a sentence.
export function shouldHandleShortcut(facts: KeyTargetFacts): boolean {
  if (facts.defaultPrevented) return false;
  if (TEXT_ENTRY_TAGS.has(facts.tagName.toUpperCase())) return false;
  if (facts.role !== null && KEY_OWNING_ROLES.has(facts.role)) return false;
  return !facts.isContentEditable;
}
