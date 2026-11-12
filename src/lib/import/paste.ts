// "Bulk add": one note per line, question and answer separated by a tab,
// " = ", a semicolon or a comma. An optional third column names the unit.

import type { RawNote } from '../core/types';

const SEPARATORS = ['\t', ' = ', ';', ','];

function pickSeparator(lines: string[]): string | null {
  for (const sep of SEPARATORS) {
    const hits = lines.filter((l) => l.includes(sep)).length;
    if (hits >= Math.max(1, Math.ceil(lines.length * 0.8))) return sep;
  }
  return null;
}

export function parseList(text: string): { rows: RawNote[]; skipped: number } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  const sep = pickSeparator(lines);
  const rows: RawNote[] = [];
  let skipped = 0;
  if (!sep) return { rows, skipped: lines.length };
  for (const line of lines) {
    const parts = line.split(sep).map((p) => p.trim().replace(/^"(.*)"$/, '$1'));
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      skipped++;
      continue;
    }
    rows.push({ front: parts[0], back: parts[1], group: parts[2] || undefined });
  }
  return { rows, skipped };
}
