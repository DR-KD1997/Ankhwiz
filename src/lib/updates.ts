// Checking for a newer Ankhwiz: when the learner taps Check now, or, if they
// have chosen it, when Ankhwiz opens (at most once a day). The one request
// goes to GitHub's public list of releases and carries nothing about the
// learner or their decks.

import { http } from './platform';
import { data, save } from './store.svelte';

export const RELEASES = 'https://github.com/DR-KD1997/Ankhwiz/releases';
const API = 'https://api.github.com/repos/DR-KD1997/Ankhwiz/releases/latest';
export const VERSION = '0.5.0';

/** Compare dotted versions: 1 when a is newer, -1 when older, 0 when equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/i, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

export type UpdateResult =
  | { state: 'newer'; version: string; notes: string; details: string; url: string }
  | { state: 'current' }
  | { state: 'none' }
  | { state: 'failed' };

/** Whether to check now that Ankhwiz has opened: chosen in Settings, and not in the last 20 hours. */
export function dueAtLaunch(at = Date.now()): boolean {
  return !!data.updates.atLaunch && (!data.updates.checked || at - data.updates.checked > 20 * 3_600_000);
}

export async function checkForUpdate(): Promise<UpdateResult> {
  const reply = await http({ url: API, method: 'GET', headers: { Accept: 'application/vnd.github+json' }, body: '' });
  data.updates.checked = Date.now();
  if (reply.status === 404) {
    save();
    return { state: 'none' };
  }
  if (reply.status !== 200) return { state: 'failed' };
  try {
    const release = JSON.parse(reply.body) as { tag_name?: string; name?: string; body?: string; html_url?: string };
    const version = (release.tag_name ?? release.name ?? '').replace(/^v/i, '');
    data.updates.latest = version || null;
    save();
    if (version && compareVersions(version, VERSION) > 0) {
      const body = (release.body ?? '').replace(/\r/g, '');
      const url = release.html_url?.startsWith('https://github.com/') ? release.html_url : RELEASES;
      return { state: 'newer', version, notes: body.split('\n').find((l) => l.trim() && !/^#/.test(l))?.trim() ?? '', details: body, url };
    }
    return { state: 'current' };
  } catch {
    return { state: 'failed' };
  }
}

/** One line of release notes, split into plain, bold and code runs. */
export interface NoteLine {
  kind: 'heading' | 'item' | 'text';
  runs: { text: string; bold?: boolean; code?: boolean }[];
}

/** Release notes (GitHub's Markdown) as plain lines to show, with no HTML. */
export function readNotes(markdown: string, limit = 40): NoteLine[] {
  const out: NoteLine[] = [];
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (!line || /^(---+|\*\*\*+)$/.test(line)) continue;
    const kind = /^#{1,6}\s/.test(line) ? 'heading' : /^[-*+]\s/.test(line) ? 'item' : 'text';
    const text = line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    const runs: NoteLine['runs'] = [];
    for (const part of text.split(/(\*\*[^*]+\*\*|`[^`]+`)/)) {
      if (!part) continue;
      if (part.startsWith('**') && part.endsWith('**')) runs.push({ text: part.slice(2, -2), bold: true });
      else if (part.startsWith('`') && part.endsWith('`')) runs.push({ text: part.slice(1, -1), code: true });
      else runs.push({ text: part });
    }
    if (runs.length) out.push({ kind, runs });
    if (out.length >= limit) break;
  }
  return out;
}
