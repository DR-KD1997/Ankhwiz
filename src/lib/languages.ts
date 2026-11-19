// Languages by name, with their country's flag, instead of codes like es-ES.
//
// Names come from the device's own language data (Intl.DisplayNames), so
// "Spanish (Spain)" and "español (España)" need no table of our own. Flags are
// made from the country part of a code (ES → 🇪🇸) and drawn with a small flag
// font carried by the app (fonts/TwemojiCountryFlags.woff2), because Windows
// has no flag emoji of its own; Linux and Android get the same flags.

/** Languages offered when choosing one, besides any already in use. */
export const COMMON_LANGS = [
  'af-ZA', 'ar-SA', 'ar-EG', 'bg-BG', 'bn-IN', 'ca-ES', 'cs-CZ', 'cy-GB', 'da-DK', 'de-DE', 'de-AT', 'de-CH', 'el-GR',
  'en-GB', 'en-US', 'en-AU', 'en-IE', 'en-IN', 'en-ZA', 'es-ES', 'es-MX', 'es-AR', 'es-US', 'et-EE', 'eu-ES', 'fa-IR',
  'fi-FI', 'fil-PH', 'fr-FR', 'fr-CA', 'fr-BE', 'fr-CH', 'ga-IE', 'gl-ES', 'gu-IN', 'he-IL', 'hi-IN', 'hr-HR', 'hu-HU',
  'hy-AM', 'id-ID', 'is-IS', 'it-IT', 'ja-JP', 'ka-GE', 'kk-KZ', 'km-KH', 'kn-IN', 'ko-KR', 'lb-LU', 'lt-LT', 'lv-LV',
  'mk-MK', 'ml-IN', 'mn-MN', 'mr-IN', 'ms-MY', 'mt-MT', 'my-MM', 'nb-NO', 'ne-NP', 'nl-NL', 'nl-BE', 'pa-IN', 'pl-PL',
  'pt-BR', 'pt-PT', 'ro-RO', 'ru-RU', 'si-LK', 'sk-SK', 'sl-SI', 'sq-AL', 'sr-RS', 'st-ZA', 'sv-SE', 'sw-KE', 'sw-CD',
  'ta-IN', 'te-IN', 'th-TH', 'tn-ZA', 'tr-TR', 'uk-UA', 'ur-PK', 'uz-UZ', 'vi-VN', 'xh-ZA', 'yue-HK', 'zh-CN', 'zh-TW',
  'zu-ZA', 'la', 'eo',
];

/** Other names people search for. */
const ALIASES: Record<string, string> = {
  es: 'castellano castilian',
  'es-MX': 'mexico mexican latin american',
  'es-AR': 'argentina rioplatense',
  'pt-BR': 'brazil brazilian',
  zh: 'mandarin chinese putonghua simplified',
  'zh-TW': 'taiwan traditional',
  'zh-HK': 'hong kong cantonese',
  yue: 'cantonese',
  fa: 'farsi persian',
  nb: 'norwegian bokmal bokmål',
  no: 'norwegian',
  fil: 'tagalog filipino pilipino',
  nl: 'dutch',
  'nl-BE': 'flemish belgium',
  he: 'hebrew ivrit',
  ga: 'irish gaelic',
  cy: 'welsh cymraeg',
  sw: 'swahili kiswahili',
  'en-GB': 'british uk english',
  'en-US': 'american usa english',
  ms: 'malay bahasa',
  id: 'indonesian bahasa',
  st: 'sesotho southern sotho',
  tn: 'setswana tswana',
  xh: 'isixhosa xhosa',
  zu: 'isizulu zulu',
  af: 'afrikaans',
};

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** A code written the usual way: es_es → es-ES, ZH-hans-cn → zh-Hans-CN. */
export function tidyLang(code: string): string {
  const parts = code.trim().replace(/_/g, '-').split('-').filter(Boolean);
  if (!parts.length) return '';
  return parts
    .map((p, i) => (i === 0 ? p.toLowerCase() : p.length === 4 ? p[0].toUpperCase() + p.slice(1).toLowerCase() : p.length <= 3 ? p.toUpperCase() : p))
    .join('-');
}

let english: Intl.DisplayNames | null | undefined;
function displayNames(locale: string): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames([locale], { type: 'language', languageDisplay: 'standard' });
  } catch {
    return null;
  }
}

/** The language's name in English, with its country: "Spanish (Spain)". The code itself if the device does not know it. */
export function langName(code: string): string {
  const tag = tidyLang(code);
  if (!tag) return '';
  if (english === undefined) english = displayNames('en');
  try {
    // A language the device does not know comes back as its own code ("xx (QQ)"): show the code instead.
    const base = tag.split('-')[0];
    if (english?.of(base) === base) return tag;
    const name = english?.of(tag);
    return name && name !== tag ? name : tag;
  } catch {
    return tag;
  }
}

/** The language's name in itself: "español (España)". Empty when it is the same as the English name. */
export function nativeName(code: string): string {
  const tag = tidyLang(code);
  try {
    const own = displayNames(tag)?.of(tag) ?? '';
    return own && own !== langName(tag) && own !== tag ? own : '';
  } catch {
    return '';
  }
}

/** The country a code belongs to: its own (es-MX → MX) or the most likely one (tr → TR). */
export function countryOf(code: string): string {
  const tag = tidyLang(code);
  if (!tag) return '';
  const own = tag.split('-').find((p, i) => i > 0 && /^[A-Z]{2}$/.test(p));
  if (own) return own;
  try {
    const region = new Intl.Locale(tag).maximize().region ?? '';
    return /^[A-Z]{2}$/.test(region) ? region : '';
  } catch {
    return '';
  }
}

/** The country's flag as an emoji (drawn by the flag font), or '' for languages without one (Latin, Esperanto). */
export function flagOf(code: string): string {
  const base = tidyLang(code).split('-')[0];
  if (['la', 'eo', 'ia', 'vo'].includes(base)) return '';
  const c = countryOf(code);
  return c ? String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)) : '';
}

/** Whether a language matches a search: its names, code, country and other names, ignoring accents and capitals. */
export function langMatches(code: string, query: string): boolean {
  const q = norm(query.trim());
  if (!q) return true;
  const tag = tidyLang(code);
  const base = tag.split('-')[0];
  const hay = norm([tag, langName(tag), nativeName(tag), ALIASES[tag] ?? '', ALIASES[base] ?? ''].join(' '));
  return q.split(/\s+/).every((w) => hay.includes(w));
}

/** Two codes for the same language and country, written either way (es_ES, es-es). */
export const sameLang = (a: string, b: string) => tidyLang(a).toLowerCase() === tidyLang(b).toLowerCase();
