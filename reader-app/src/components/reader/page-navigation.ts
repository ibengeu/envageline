export function scrollPageIntoView(scroller: HTMLElement, page: number): boolean {
  // OWASP A02:2025 Security Misconfiguration.
  // Accept only positive integer page values before building the page selector.
  // This control prevents malformed selector input from reaching the DOM query.
  if (!Number.isSafeInteger(page) || page < 1) return false;

  const target = scroller.querySelector<HTMLElement>('[data-page="' + page + '"]');
  if (!target) return false;

  const scrollerRect = scroller.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  // A page that already covers most of the view is where the reader is
  // looking: re-aligning it to its top edge would only yank the text away.
  const visible =
    Math.min(targetRect.bottom, scrollerRect.bottom) - Math.max(targetRect.top, scrollerRect.top);
  if (visible >= (scrollerRect.bottom - scrollerRect.top) * 0.5) return true;
  const top = targetRect.top - scrollerRect.top + scroller.scrollTop;
  scroller.scrollTo({ top, behavior: "auto" });
  return true;
}
