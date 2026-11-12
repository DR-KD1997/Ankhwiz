// Writing an Anki .apkg file: the core lays out the collection's rows
// (`ankiExport`), and this writes them into an SQLite collection in Anki's
// long-supported schema 11, zipped with the deck's media. Every Anki
// version from 2.1 onwards can import it.

import { strToU8, zipSync } from 'fflate';
import { ankiExport } from '../core';
import type { Deck, Progress } from '../core/types';
import { openInBrowser, type OpenDatabase } from '../import/sql';

const SCHEMA = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null,
  dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null,
  dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null,
  tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null,
  usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null,
  factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null,
  odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null,
  lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;

export interface ApkgResult {
  bytes: Uint8Array;
  notes: number;
  cards: number;
  media: number;
  /** Media files a card names but this device does not have. */
  missing: string[];
}

export async function buildApkg(
  deck: Deck,
  progress: Progress,
  withProgress: boolean,
  mediaOf: (name: string) => Promise<Uint8Array | null>,
  open: OpenDatabase = openInBrowser,
): Promise<ApkgResult> {
  const out = ankiExport(deck, progress, withProgress);
  const db = await open();
  try {
    db.exec(SCHEMA);
    const now = Date.now();
    const secs = Math.floor(now / 1000);
    db.run('INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, ?)', [out.crt, now, now, out.conf, out.models, out.decks, out.dconf, '{}']);
    db.exec('BEGIN');
    for (const n of out.notes) {
      db.run('INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, ?)', [n.id, n.guid, n.mid, secs, n.tags, n.flds, n.sfld, n.csum, '']);
    }
    for (const c of out.cards) {
      db.run('INSERT INTO cards VALUES (?, ?, ?, ?, ?, -1, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?)', [
        c.id, c.nid, c.did, c.ord, secs, c.ctype, c.queue, c.due, c.ivl, c.factor, c.reps, c.lapses, c.data,
      ]);
    }
    for (const r of out.revlog) {
      db.run('INSERT OR IGNORE INTO revlog VALUES (?, ?, -1, ?, ?, ?, ?, ?, ?)', [r.id, r.cid, r.ease, r.ivl, r.lastIvl, r.factor, r.time, r.rtype]);
    }
    db.exec('COMMIT');
    const files: Record<string, Uint8Array> = { 'collection.anki2': db.export() };
    const list: Record<string, string> = {};
    const missing: string[] = [];
    let i = 0;
    for (const name of out.media) {
      const bytes = await mediaOf(name);
      if (!bytes) {
        missing.push(name);
        continue;
      }
      files[String(i)] = bytes;
      list[String(i)] = name;
      i++;
    }
    files['media'] = strToU8(JSON.stringify(list));
    return { bytes: zipSync(files, { level: 6 }), notes: out.notes.length, cards: out.cards.length, media: i, missing };
  } finally {
    db.close();
  }
}
