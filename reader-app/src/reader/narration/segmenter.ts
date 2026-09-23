const ABBREVIATIONS = [
  "Dr.",
  "Mr.",
  "Mrs.",
  "Ms.",
  "Prof.",
  "Sr.",
  "Jr.",
  "vs.",
  "etc.",
  "e.g.",
  "i.e.",
  "U.S.",
  "No.",
  "Fig.",
  "Vol.",
  "pp.",
  "approx.",
  "Inc.",
  "Ltd.",
  "Co.",
  "St.",
  "Jan.",
  "Feb.",
  "Mar.",
  "Apr.",
  "Jun.",
  "Jul.",
  "Aug.",
  "Sep.",
  "Sept.",
  "Oct.",
  "Nov.",
  "Dec.",
  "al.",
];

export function splitSentences(text: string): string[] {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return [];

  const placeholders: string[] = [];
  const protect = (value: string) => {
    const token = `⟦${placeholders.length}⟧`;
    placeholders.push(value);
    return token;
  };

  let working = trimmed;
  for (const abbr of ABBREVIATIONS) {
    working = working.split(abbr).join(protect(abbr));
  }
  working = working.replace(/\b[A-Z]\./g, (m) => protect(m));
  working = working.replace(/\d+\.\d+/g, (m) => protect(m));

  const parts = working
    // A protected abbreviation (⟦n⟧) can open the next sentence ("Dr. Rivera"),
    // so it counts as a sentence start just like a capital letter does.
    .split(/(?<=[.!?])\s+(?=[“"'(A-Z⟦])/)
    .map((part) => {
      let restored = part;
      placeholders.forEach((value, index) => {
        restored = restored.split(`⟦${index}⟧`).join(value);
      });
      return restored.trim();
    })
    .filter(Boolean);

  const merged: string[] = [];
  for (const part of parts) {
    const last = merged.at(-1);
    if (last && part.length < 18 && !/[.!?]$/.test(last)) {
      merged[merged.length - 1] = `${last} ${part}`;
    } else {
      merged.push(part);
    }
  }
  return merged.length > 0 ? merged : [trimmed];
}
