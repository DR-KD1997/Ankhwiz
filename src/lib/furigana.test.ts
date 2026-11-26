import { describe, expect, it } from 'vitest';
import { align, hasReadings, kanaOf, pieces, plainOf, romajiToKana, rubyToBrackets } from './furigana';

describe('furigana', () => {
  it('reads Anki brackets like the core', () => {
    const s = '毎朝[まいあさ] 日本語[にほんご]を 勉強[べんきょう]しています。';
    expect(plainOf(s)).toBe('毎朝日本語を勉強しています。');
    expect(kanaOf(s)).toBe('まいあさにほんごをべんきょうしています。');
    expect(pieces(s).slice(0, 3)).toEqual([{ base: '毎朝', reading: 'まいあさ' }, { base: '日本語', reading: 'にほんご' }, { base: 'を' }]);
    expect(hasReadings('note [1]')).toBe(false);
  });
  it('aligns a kana reading with a word', () => {
    expect(align('食べ物', 'たべもの')).toBe('食[た]べ 物[もの]');
    expect(align('勉強', 'ベンキョウ')).toBe('勉強[べんきょう]');
    expect(align('食べ物', 'のみもの')).toBeNull();
  });
  it('turns ruby markup into brackets', () => {
    expect(rubyToBrackets('<ruby>日本<rp>(</rp><rt>にほん</rt><rp>)</rp></ruby>語')).toBe(' 日本[にほん]語');
    expect(rubyToBrackets('<ruby><rb>漢</rb><rt>かん</rt><rb>字</rb><rt>じ</rt></ruby>')).toBe(' 漢[かん] 字[じ]');
  });
  it('turns romaji into kana', () => {
    expect(romajiToKana('benkyou')).toBe('べんきょう');
    expect(romajiToKana('gakkou')).toBe('がっこう');
    expect(romajiToKana('shinbun', true)).toBe('しんぶん');
    expect(romajiToKana('shinbun')).toBe('しんぶn');
    expect(romajiToKana('konnichiha')).toBe('こんにちは');
    expect(romajiToKana('kan')).toBe('かn');
    expect(romajiToKana('kanji')).toBe('かんじ');
  });
});
