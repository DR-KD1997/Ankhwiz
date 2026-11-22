// Interface text in the learner's language.
//
// Text is written in English where it is used and looked up by its English
// wording: `t('Your answer')`, `t('{n} days in a row', { n })`. Each other
// language has one dictionary from English wording to its own (see
// `translations.ts`); wording it does not have yet stays English, so a
// partial translation still works. Thoth's lines and the lesson screen's
// words also have short keys (`en.ts`): `t('continue')` is `t('Continue')`.
// Cards are never translated: only Ankhwiz's own words.
//
// Numbers and dates go through `Intl` in the same language. The interface is
// drawn again when the language changes (App keys the screens by it).

import { en } from './en';
import { DICTIONARIES } from './translations';

/** One language's dictionary: English wording to its own. A plural entry gives each form. */
export type Dictionary = Record<string, string | Partial<Record<Intl.LDMLPluralRule, string>>>;

/** The languages Ankhwiz speaks, in their own names. */
export const APP_LANGUAGES = [
  { code: 'en', own: 'English', english: 'English' },
  { code: 'tr', own: 'Türkçe', english: 'Turkish' },
  { code: 'es', own: 'Español', english: 'Spanish' },
  { code: 'pt-BR', own: 'Português (Brasil)', english: 'Portuguese (Brazil)' },
  { code: 'fr', own: 'Français', english: 'French' },
  { code: 'de', own: 'Deutsch', english: 'German' },
  { code: 'it', own: 'Italiano', english: 'Italian' },
  { code: 'ru', own: 'Русский', english: 'Russian' },
  { code: 'ja', own: '日本語', english: 'Japanese' },
  { code: 'zh-Hans', own: '简体中文', english: 'Chinese (Simplified)' },
] as const;
export type AppLanguage = (typeof APP_LANGUAGES)[number]['code'];

let current: AppLanguage = 'en';
let dict: Dictionary = {};

/** The app language for a device language such as pt-PT or zh-CN (English when Ankhwiz does not speak it). */
export function matchLanguage(tag: string): AppLanguage {
  const t = (tag || '').toLowerCase();
  if (t.startsWith('pt')) return 'pt-BR';
  if (t.startsWith('zh')) return 'zh-Hans';
  const hit = APP_LANGUAGES.find((l) => l.code.toLowerCase() === t || t.startsWith(`${l.code.toLowerCase()}-`));
  return hit?.code ?? 'en';
}

/** The device's own language, as an app language. */
export function deviceLanguage(): AppLanguage {
  const tags = typeof navigator !== 'undefined' ? [...(navigator.languages ?? []), navigator.language] : [];
  for (const tag of tags) {
    const m = matchLanguage(tag);
    if (m !== 'en' || tag.toLowerCase().startsWith('en')) return m;
  }
  return 'en';
}

/** Use a language: a code, or '' / 'system' for the device's own. */
export function setLanguage(code: string): AppLanguage {
  const next = !code || code === 'system' ? deviceLanguage() : matchLanguage(code);
  current = next;
  dict = DICTIONARIES[next] ?? {};
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  return next;
}

export function language(): AppLanguage {
  return current;
}

/** The English name of the language in use, for asking Thoth to reply in it. */
export function languageInEnglish(code: string = current): string {
  return APP_LANGUAGES.find((l) => l.code === code)?.english ?? 'English';
}

type Key = keyof typeof en;

function source(text: string): string {
  const raw = (en as Record<string, string | readonly string[]>)[text];
  if (raw === undefined) return text;
  return Array.isArray(raw) ? raw[0] : (raw as string);
}

function lookUp(src: string): string {
  const hit = dict[src];
  return typeof hit === 'string' && hit ? hit : typeof hit === 'object' && hit?.other ? hit.other : src;
}

/** Interface text in the learner's language, with {name} placeholders filled in. */
export function t(text: string, vars: Record<string, string | number | null | undefined> = {}): string {
  return fill(lookUp(source(text)), vars);
}

/** Every variant of a key that has several (Thoth's lines rotate through them). */
export function variants(key: Key): readonly string[] {
  const raw = en[key] as string | readonly string[];
  return (Array.isArray(raw) ? raw : [raw as string]).map(lookUp);
}

/**
 * Text that changes with a count: `plural('{n} card', '{n} cards', n)`.
 * Languages with more forms give each form in their dictionary.
 */
export function plural(one: string, other: string, n: number, vars: Record<string, string | number | null | undefined> = {}): string {
  const all = { n: number(n), ...vars };
  const hit = dict[other];
  if (current !== 'en' && hit) {
    if (typeof hit === 'string') return fill(hit, all);
    const rule = new Intl.PluralRules(current).select(n);
    const form = hit[rule] ?? hit.other ?? other;
    return fill(form, all);
  }
  return fill(n === 1 ? one : other, all);
}

/**
 * A name Ankhwiz gave itself, such as "Lesson 3" or "Unit 2", in the learner's
 * language. Names people chose are shown as they are.
 */
export function shownName(name: string): string {
  const m = /^(Lesson|Unit) (\d+)$/.exec(name.trim());
  if (!m) return name;
  return m[1] === 'Lesson' ? t('Lesson {n}', { n: m[2] }) : t('Unit {n}', { n: m[2] });
}

/** A stage's name (from the core, in English) in the learner's language. */
export function stageName(name: string): string {
  switch (name) {
    case 'Meet': return t('Meet');
    case 'Recognise': return t('Recognise');
    case 'Assisted recall': return t('Assisted recall');
    case 'Firm recall': return t('Firm recall');
    case 'Mastered': return t('Mastered');
    default: return name;
  }
}

export function number(n: number): string {
  return new Intl.NumberFormat(current).format(n);
}

/** A date in the learner's language. */
export function date(ms: number, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  return new Intl.DateTimeFormat(current, opts).format(ms);
}

function fill(text: string, vars: Record<string, string | number | null | undefined>): string {
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name] ?? '') : m));
}
