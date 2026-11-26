// Furigana: kana readings over kanji, in Anki's form 日本[にほん]. The same
// rules as the core's furigana.rs: a reading belongs to the run of characters
// before it, back to the previous space (which only marks where the run starts
// and is not shown). Only brackets holding kana count as readings.

export interface Piece {
  base: string;
  reading?: string;
}

const KANA = /^[ぁ-ゟ゠-ヿㇰ-ㇿ]+$/;
const KANJI = /[一-鿿㐀-䶿豈-﫿々〆ヶ]/;
export const isKanaText = (s: string) => KANA.test(s);
export const hasKanji = (s: string) => KANJI.test(s);
const isKanjiChar = (c: string) => KANJI.test(c);

export function pieces(s: string): Piece[] {
  if (!s.includes('[')) return [{ base: s }];
  const out: Piece[] = [];
  let plain = '';
  let runStart = 0;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '[') {
      const end = s.indexOf(']', i + 1);
      if (end > i) {
        const reading = s.slice(i + 1, end);
        const run = plain.slice(runStart);
        if (reading && KANA.test(reading) && run.trim()) {
          plain = plain.slice(0, runStart);
          if (plain.endsWith(' ') && !run.startsWith(' ')) plain = plain.slice(0, -1);
          if (plain) out.push({ base: plain });
          plain = '';
          out.push({ base: run.trimStart(), reading });
          runStart = 0;
          i = end + 1;
          continue;
        }
      }
    }
    plain += c;
    if (c === ' ' || c === '>' || c === '　') runStart = plain.length;
    i++;
  }
  if (plain) out.push({ base: plain });
  return out;
}

export const hasReadings = (s: string | null | undefined) => !!s && s.includes('[') && pieces(s).some((p) => p.reading);
/** The text without its readings: 日本[にほん]語 → 日本語. */
export const plainOf = (s: string) => (s.includes('[') ? pieces(s).map((p) => p.base).join('') : s);
/** The text as read: 日本[にほん]語 → にほん語. */
export const kanaOf = (s: string) => (s.includes('[') ? pieces(s).map((p) => p.reading ?? p.base).join('') : s);
export const toHiragana = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
/** Words with readings in a text. */
export const readingWords = (s: string) => pieces(s).filter((p) => p.reading).map((p) => p.base);

/** A word and its kana-only reading joined into Anki's form (食べ物 + たべもの → 食[た]べ 物[もの]), or null when it does not fit. */
export function align(word: string, reading: string): string | null {
  word = word.trim();
  const r = toHiragana(reading.trim());
  if (!hasKanji(word) || !r || !KANA.test(r)) return null;
  const runs: { kanji: boolean; text: string }[] = [];
  for (const c of word) {
    const k = isKanjiChar(c);
    const last = runs[runs.length - 1];
    if (last && last.kanji === k) last.text += c;
    else runs.push({ kanji: k, text: c });
  }
  const out: string[] = [];
  const fit = (ri: number, at: number): boolean => {
    if (ri === runs.length) return at === r.length;
    const run = runs[ri];
    if (!run.kanji) {
      const t = toHiragana(run.text);
      if (r.startsWith(t, at)) {
        out.push(run.text);
        if (fit(ri + 1, at + t.length)) return true;
        out.pop();
      }
      return false;
    }
    for (let end = at + 1; end <= r.length; end++) {
      out.push(` ${run.text}[${r.slice(at, end)}]`);
      if (fit(ri + 1, end)) return true;
      out.pop();
    }
    return false;
  };
  return fit(0, 0) ? out.join('').trimStart() : null;
}

/** Anki's ruby markup turned into its bracket form, before the markup is stripped. */
export function rubyToBrackets(html: string): string {
  if (!/<ruby/i.test(html)) return html;
  return html.replace(/<ruby[^>]*>([\s\S]*?)<\/ruby>/gi, (_, inner: string) => {
    const body = inner.replace(/<rp[^>]*>[\s\S]*?<\/rp>/gi, '').replace(/<\/?rb[^>]*>/gi, '');
    let out = '';
    for (const m of body.matchAll(/([\s\S]*?)<rt[^>]*>([\s\S]*?)<\/rt>/gi)) {
      const base = m[1].replace(/<[^>]+>/g, '').trim();
      const reading = m[2].replace(/<[^>]+>/g, '').trim();
      if (!base) continue;
      out += reading && KANA.test(reading) ? ` ${base}[${reading}]` : reading ? `${base} (${reading})` : base;
    }
    return out || body.replace(/<[^>]+>/g, '');
  });
}

// Romaji typed on any keyboard, turned into hiragana as it is typed.
const ROMAJI: Record<string, string> = { a:'あ',i:'い',u:'う',e:'え',o:'お',ka:'か',ki:'き',ku:'く',ke:'け',ko:'こ',sa:'さ',shi:'し',si:'し',su:'す',se:'せ',so:'そ',ta:'た',chi:'ち',ti:'ち',tsu:'つ',tu:'つ',te:'て',to:'と',na:'な',ni:'に',nu:'ぬ',ne:'ね',no:'の',ha:'は',hi:'ひ',fu:'ふ',hu:'ふ',he:'へ',ho:'ほ',ma:'ま',mi:'み',mu:'む',me:'め',mo:'も',ya:'や',yu:'ゆ',yo:'よ',ra:'ら',ri:'り',ru:'る',re:'れ',ro:'ろ',wa:'わ',wo:'を',ga:'が',gi:'ぎ',gu:'ぐ',ge:'げ',go:'ご',za:'ざ',ji:'じ',zi:'じ',zu:'ず',ze:'ぜ',zo:'ぞ',da:'だ',di:'ぢ',du:'づ',de:'で',do:'ど',ba:'ば',bi:'び',bu:'ぶ',be:'べ',bo:'ぼ',pa:'ぱ',pi:'ぴ',pu:'ぷ',pe:'ぺ',po:'ぽ',kya:'きゃ',kyu:'きゅ',kyo:'きょ',sha:'しゃ',shu:'しゅ',sho:'しょ',sya:'しゃ',syu:'しゅ',syo:'しょ',cha:'ちゃ',chu:'ちゅ',cho:'ちょ',tya:'ちゃ',tyu:'ちゅ',tyo:'ちょ',nya:'にゃ',nyu:'にゅ',nyo:'にょ',hya:'ひゃ',hyu:'ひゅ',hyo:'ひょ',mya:'みゃ',myu:'みゅ',myo:'みょ',rya:'りゃ',ryu:'りゅ',ryo:'りょ',gya:'ぎゃ',gyu:'ぎゅ',gyo:'ぎょ',ja:'じゃ',ju:'じゅ',jo:'じょ',jya:'じゃ',jyu:'じゅ',jyo:'じょ',zya:'じゃ',zyu:'じゅ',zyo:'じょ',bya:'びゃ',byu:'びゅ',byo:'びょ',pya:'ぴゃ',pyu:'ぴゅ',pyo:'ぴょ',fa:'ふぁ',fi:'ふぃ',fe:'ふぇ',fo:'ふぉ',xa:'ぁ',xi:'ぃ',xu:'ぅ',xe:'ぇ',xo:'ぉ',xtu:'っ',xtsu:'っ',ltu:'っ',xya:'ゃ',xyu:'ゅ',xyo:'ょ','-':'ー' };

/** Romaji in a typed answer turned into hiragana; a lone n is kept until the next letter shows whether it is ん. */
export function romajiToKana(input: string, final = false): string {
  const s = input.toLowerCase();
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (!/[a-z'-]/.test(c)) {
      out += c;
      i++;
      continue;
    }
    if (c === 'n' && (s[i + 1] === "'" || (s[i + 1] === 'n' && s[i + 2] !== undefined && !'aiueoy'.includes(s[i + 2])) || (s[i + 1] === 'n' && s[i + 2] === undefined))) {
      out += 'ん';
      i += 2;
      continue;
    }
    if (c === 'n' && s[i + 1] !== undefined && !'aiueoy'.includes(s[i + 1])) {
      out += 'ん';
      i++;
      continue;
    }
    if (/[bcdfghjkmprstvwz]/.test(c) && s[i + 1] === c) {
      out += 'っ';
      i++;
      continue;
    }
    let hit = false;
    for (const len of [4, 3, 2, 1]) {
      const k = s.slice(i, i + len);
      if (ROMAJI[k]) {
        out += ROMAJI[k];
        i += len;
        hit = true;
        break;
      }
    }
    if (!hit) {
      out += c;
      i++;
    }
  }
  // Once the answer is given, a last n can only be ん.
  return final ? out.replace(/n$/, 'ん') : out;
}

/** Whether a deck is Japanese: its language says so, or its cards have kana (or readings) beside their kanji. */
export function isJapaneseDeck(deck: { notes: Record<string, { front: string; back: string }>; options: { look: { lang: string; langBack?: string } } }): boolean {
  const l = deck.options.look;
  if (/^ja\b/i.test(l.lang) || /^ja\b/i.test(l.langBack ?? '')) return true;
  const notes = Object.values(deck.notes);
  if (!notes.length) return false;
  let kanji = 0;
  let japanese = 0;
  for (const n of notes) {
    const text = n.front + ' ' + n.back;
    if (!hasKanji(text)) continue;
    kanji++;
    // Kana beside kanji is Japanese, not Chinese.
    if (/[ぁ-ゟァ-ヺ]/.test(plainOf(text)) || hasReadings(text)) japanese++;
  }
  return kanji >= 3 && japanese >= Math.max(2, kanji * 0.2);
}

/** Cards whose question or answer has kanji, and how many of those have readings. */
export function readingCoverage(deck: { notes: Record<string, { front: string; back: string; cloze?: boolean }> }): { kanji: number; read: number } {
  let kanji = 0;
  let read = 0;
  for (const n of Object.values(deck.notes)) {
    if (n.cloze) continue;
    const text = n.front + ' ' + n.back;
    if (!hasKanji(plainOf(text))) continue;
    kanji++;
    if (hasReadings(n.front) || hasReadings(n.back)) read++;
  }
  return { kanji, read };
}
