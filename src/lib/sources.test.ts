import { describe, expect, it } from 'vitest';
import { pageUrl, passagesFor, quoteFound, sectionsFromMarkdown, sectionsFromText } from './sources';

describe('sources', () => {
  it('divides text at paragraph ends and Markdown at headings', () => {
    const long = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} ` + 'word '.repeat(30)).join('\n\n');
    const parts = sectionsFromText(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0].at).toBe('§1');
    const md = sectionsFromMarkdown('# Cell membrane\nThe **membrane** is a [bilayer](x).\n\n## Diffusion\n- Small molecules pass\n');
    expect(md.map((s) => s.at)).toEqual(['Cell membrane', 'Diffusion']);
    expect(md[0].text).toBe('The membrane is a bilayer.');
    expect(md[1].text).toBe('• Small molecules pass');
  });
  it('finds a quote word for word, or nearly', () => {
    const text = 'Every cycle, the pump pushes three sodium ions out and brings two potassium ions in, and it burns one ATP doing it.';
    expect(quoteFound('The pump pushes three sodium ions out and brings two potassium ions in.', text)).toBe(true);
    expect(quoteFound('the pump pushes 3 sodium ions out and brings two potassium ions in', text)).toBe(true);
    expect(quoteFound('Mitochondria make most of the cell’s ATP.', text)).toBe(false);
    expect(quoteFound('ATP', text)).toBe(false);
  });
  it('gathers the passages a lesson draws on', () => {
    const texts = new Map([['s1', [{ at: 'p. 1', text: 'One' }, { at: 'p. 2', text: 'Two' }, { at: 'p. 2 (2)', text: 'More two' }]]]);
    expect(passagesFor({ from: [['s1', 'p. 2']] }, texts)).toBe('[s1 · p. 2]\nTwo\n\n[s1 · p. 2 (2)]\nMore two');
  });
  it('recognises web addresses', () => {
    expect(pageUrl('example.org/page')).toBe('https://example.org/page');
    expect(pageUrl('https://a.b/c?d=1')).toBe('https://a.b/c?d=1');
    expect(pageUrl('not a link')).toBe('');
    expect(pageUrl('javascript:alert(1)')).toBe('');
  });
});
