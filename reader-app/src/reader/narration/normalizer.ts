const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
];
const TEENS = [
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];

function underHundred(n: number): string {
  if (n < 10) return ONES[n] ?? String(n);
  if (n < 20) return TEENS[n - 10] ?? String(n);
  const ten = Math.floor(n / 10);
  const one = n % 10;
  return one ? `${TENS[ten]}-${ONES[one]}` : (TENS[ten] ?? String(n));
}

export function integerToWords(value: number): string {
  const n = Math.trunc(Math.abs(value));
  if (n < 100) return underHundred(n);
  if (n < 1000) {
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    return rest
      ? `${ONES[hundreds]} hundred ${underHundred(rest)}`
      : `${ONES[hundreds]} hundred`;
  }
  if (n < 1_000_000) {
    const thousands = Math.floor(n / 1000);
    const rest = n % 1000;
    const head = `${integerToWords(thousands)} thousand`;
    return rest ? `${head} ${integerToWords(rest)}` : head;
  }
  return String(n);
}

function parseNumberToken(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "");
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export function numberToSpoken(raw: string): string {
  const cleaned = raw.replace(/,/g, "");
  const negative = cleaned.startsWith("-");
  const unsigned = negative ? cleaned.slice(1) : cleaned;
  const [wholeRaw, fracRaw] = unsigned.split(".");
  const whole = Number(wholeRaw ?? "0");
  if (!Number.isFinite(whole)) return raw;
  let spoken = integerToWords(whole);
  if (fracRaw && /[1-9]/.test(fracRaw)) {
    const digits = [...fracRaw].map((d) => ONES[Number(d)] ?? d).join(" ");
    spoken = `${spoken} point ${digits}`;
  }
  return negative ? `minus ${spoken}` : spoken;
}

const LETTERS = new Set([
  "CPU",
  "GPU",
  "API",
  "PDF",
  "OCR",
  "TTS",
  "HTML",
  "CSS",
  "SQL",
  "HTTP",
  "JSON",
  "XML",
  "URL",
  "USB",
  "SSD",
  "RAM",
  "AI",
  "ML",
  "UI",
  "UX",
  "ID",
  "UK",
  "US",
  "USA",
  "UN",
  "FBI",
  "CEO",
  "CTO",
  "CFO",
]);

const WORDS = new Set(["NASA", "NATO", "UNESCO", "FIFA", "AIDS", "LASER"]);

const TITLES: Record<string, string> = {
  "Dr.": "Doctor",
  "Mr.": "Mister",
  "Mrs.": "Missus",
  "Ms.": "Miss",
  "Prof.": "Professor",
  "Sr.": "Senior",
  "Jr.": "Junior",
  "vs.": "versus",
  "etc.": "etcetera",
  "e.g.": "for example",
  "i.e.": "that is",
  "approx.": "approximately",
  "fig.": "figure",
  "vol.": "volume",
  "pp.": "pages",
  "No.": "number",
};

const UNITS: Record<string, string> = {
  km: "kilometers",
  cm: "centimeters",
  mm: "millimeters",
  kg: "kilograms",
  mg: "milligrams",
  lb: "pounds",
  ft: "feet",
  m: "meters",
  mph: "miles per hour",
  kb: "kilobytes",
  mb: "megabytes",
  gb: "gigabytes",
};

function scaleWord(scale: string): string {
  switch (scale.toUpperCase()) {
    case "K":
      return "thousand";
    case "M":
      return "million";
    case "B":
      return "billion";
    default:
      return "";
  }
}

function spellLetters(token: string): string {
  return [...token].join(" ");
}

export function normalizeText(input: string): string {
  let text = input;

  text = text.replace(
    /\$(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)(\s*[KMB])?\b/g,
    (_all, raw: string, scale?: string) => {
      const spoken = numberToSpoken(raw);
      const mag = scale ? ` ${scaleWord(scale.trim())}` : "";
      return `${spoken}${mag} dollars`;
    },
  );

  text = text.replace(
    /€(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)(\s*[KMB])?\b/g,
    (_all, raw: string, scale?: string) => {
      const spoken = numberToSpoken(raw);
      const mag = scale ? ` ${scaleWord(scale.trim())}` : "";
      return `${spoken}${mag} euros`;
    },
  );

  text = text.replace(
    /(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)%/g,
    (_all, raw: string) => `${numberToSpoken(raw)} percent`,
  );

  text = text.replace(
    /\b(\d+(?:\.\d+)?)\s*(km|cm|mm|kg|mg|lb|ft|mph|kb|mb|gb)\b/gi,
    (_all, raw: string, unit: string) => {
      const label = UNITS[unit.toLowerCase()] ?? unit;
      return `${numberToSpoken(raw)} ${label}`;
    },
  );

  text = text.replace(/\bYoY\b/g, "year over year");
  text = text.replace(/\bQoQ\b/g, "quarter over quarter");
  text = text.replace(/\bQ1\b/g, "first quarter");
  text = text.replace(/\bQ2\b/g, "second quarter");
  text = text.replace(/\bQ3\b/g, "third quarter");
  text = text.replace(/\bQ4\b/g, "fourth quarter");

  text = text.replace(
    /\b(Dr|Mr|Mrs|Ms|Prof|Sr|Jr|vs|etc|fig|vol|pp|No|approx)\./g,
    (token) => TITLES[token] ?? token,
  );
  text = text.replace(/\be\.g\./g, "for example");
  text = text.replace(/\bi\.e\./g, "that is");

  text = text.replace(/\bU\.S\./g, "U S");

  text = text.replace(/\b([A-Z]{2,6})\b/g, (token) => {
    if (WORDS.has(token)) return token;
    if (LETTERS.has(token)) return spellLetters(token);
    return token;
  });

  text = text.replace(/\s{2,}/g, " ").trim();
  return text;
}
