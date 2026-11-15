import { describe, expect, it } from 'vitest';
import { DATA_VERSION, migrate } from './store.svelte';
import { _sets, SOUND_SETS } from './sounds';
import { moved } from './ui/sortable';
import { readNotes } from './updates';

describe('stored data from 0.4.0', () => {
  it('turns read aloud into a deck switch and keeps reading by itself', () => {
    const saved: Record<string, unknown> = {
      v: 3,
      settings: { theme: 'system' },
      decks: {
        a: { options: { look: { speak: 'question', lang: 'es-ES' } } },
        b: { options: { look: { speak: 'off' } } },
        c: { options: { look: { speak: 'answer', lang: 'fr-FR' } } },
      },
    };
    expect(migrate(saved)).toBe(true);
    expect(saved.v).toBe(DATA_VERSION);
    const look = (id: string) => (saved.decks as Record<string, { options: { look: { speak: string } } }>)[id].options.look.speak;
    expect([look('a'), look('b'), look('c')]).toEqual(['on', 'off', 'on']);
    expect((saved.settings as { autoRead?: string }).autoRead).toBe('both');
  });

  it('leaves reading by itself unset when no deck read aloud', () => {
    const saved: Record<string, unknown> = { v: 3, settings: {}, decks: { a: { options: { look: { speak: 'off' } } } } };
    migrate(saved);
    expect((saved.settings as { autoRead?: string }).autoRead).toBeUndefined();
  });
});

describe('sound sets', () => {
  it('has every moment in every set', () => {
    for (const s of SOUND_SETS) expect(Object.keys(_sets[s.id]).sort()).toEqual(['end', 'nearly', 'right', 'wrong']);
  });
});

describe('reordering fields', () => {
  it('moves an item and keeps the rest in order', () => {
    expect(moved(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moved(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });
});

describe('release notes', () => {
  it('reads headings, items, bold and code without any HTML', () => {
    const lines = readNotes('# Ankhwiz 0.4.1\n\nSounds and voices.\n\n## Added\n- **Answer sounds** in `Settings`\n- [Link](https://x) <b>kept as text</b>\n');
    expect(lines.map((l) => l.kind)).toEqual(['heading', 'text', 'heading', 'item', 'item']);
    expect(lines[3].runs).toEqual([{ text: 'Answer sounds', bold: true }, { text: ' in ' }, { text: 'Settings', code: true }]);
    expect(lines[4].runs[0].text).toBe('Link <b>kept as text</b>');
  });
});
