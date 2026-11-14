// Interface text, ready for translation.
//
// Text lives in one dictionary per language (`en.ts` is the source); the
// interface asks for it by key with `t('key', { name: … })`. A missing key
// in another language falls back to English, so a partial translation still
// works. Numbers and dates go through `Intl` in the same language.
//
// 0.4 moves Thoth's lines and the lesson screen's words here; the rest of the
// interface still has its English inline and moves over screen by screen.

import { en, type Messages } from './en';

const languages: Record<string, Partial<Messages>> = { en };
let current = 'en';

/** Available languages (only English so far). */
export const LANGUAGES = Object.keys(languages);

export function setLanguage(code: string): void {
  current = languages[code] ? code : 'en';
  document.documentElement.lang = current;
}

export function language(): string {
  return current;
}

type Key = keyof Messages;

/** The text for a key, with {name} placeholders filled in. */
export function t(key: Key, vars: Record<string, string | number> = {}): string {
  const raw = (languages[current]?.[key] ?? en[key]) as string | readonly string[];
  const text = Array.isArray(raw) ? raw[0] : (raw as string);
  return fill(text, vars);
}

/** Every variant of a key that has several (Thoth's lines rotate through them). */
export function variants(key: Key): readonly string[] {
  const raw = (languages[current]?.[key] ?? en[key]) as string | readonly string[];
  return Array.isArray(raw) ? raw : [raw as string];
}

/** One form or the other by count: plural('card', n) uses card_one / card_other. */
export function plural(key: string, n: number, vars: Record<string, string | number> = {}): string {
  const rule = new Intl.PluralRules(current).select(n);
  const k = (`${key}_${rule}` in en ? `${key}_${rule}` : `${key}_other`) as Key;
  return t(k, { n: number(n), ...vars });
}

export function number(n: number): string {
  return new Intl.NumberFormat(current).format(n);
}

function fill(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}
