// The dictionaries of the languages Ankhwiz speaks besides English. Each maps
// English interface wording to its own (see index.ts). They are compiled from
// the translators' files in lang/ by scripts/i18n-compile.mjs.

import type { Dictionary } from './index';

const files = import.meta.glob<Dictionary>('./dict/*.json', { eager: true, import: 'default' });

export const DICTIONARIES: Record<string, Dictionary> = Object.fromEntries(
  Object.entries(files).map(([file, dict]) => [file.replace(/^.*\/|\.json$/g, ''), dict]),
);
