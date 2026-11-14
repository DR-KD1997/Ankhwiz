// Checking for a newer Ankhwiz, only when the learner asks. The one request
// goes to GitHub's public list of releases and carries nothing about the
// learner or their decks.

import { http } from './platform';
import { data, save } from './store.svelte';

export const RELEASES = 'https://github.com/DR-KD1997/Ankhwiz/releases';
const API = 'https://api.github.com/repos/DR-KD1997/Ankhwiz/releases/latest';
export const VERSION = '0.4.0';

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

export type UpdateResult = { state: 'newer'; version: string; notes: string } | { state: 'current' } | { state: 'none' } | { state: 'failed' };

export async function checkForUpdate(): Promise<UpdateResult> {
  const reply = await http({ url: API, method: 'GET', headers: { Accept: 'application/vnd.github+json' }, body: '' });
  data.updates.checked = Date.now();
  if (reply.status === 404) {
    save();
    return { state: 'none' };
  }
  if (reply.status !== 200) return { state: 'failed' };
  try {
    const release = JSON.parse(reply.body) as { tag_name?: string; name?: string; body?: string };
    const version = (release.tag_name ?? release.name ?? '').replace(/^v/i, '');
    data.updates.latest = version || null;
    save();
    if (version && compareVersions(version, VERSION) > 0) return { state: 'newer', version, notes: (release.body ?? '').split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '') ?? '' };
    return { state: 'current' };
  } catch {
    return { state: 'failed' };
  }
}
