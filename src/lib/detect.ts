// Telling which language a deck's fields are in, on this device and without
// AI: by writing system first (Cyrillic, Greek, Arabic, Hebrew, Devanagari,
// Thai, kana, hangul, Chinese characters…), then, for languages written in
// Latin letters, by the letters only some languages use and by their most
// common short words. Used by "Prepare for Ankhwiz" to choose voices.

type Score = Record<string, number>;

// Most common short words, as they appear in flashcards (lower case).
const WORDS: Record<string, string> = {
  'en-GB': 'the a an of to and is are you i it in on for this that what my your be have do not with he she we they',
  'es-ES': 'el la los las de que y en un una es por con para no se lo mi tu su al del muy yo está qué cómo',
  'fr-FR': 'le la les de des du et est un une je tu il elle nous vous pas que qui en au aux ce cette pour avec',
  'de-DE': 'der die das und ist ein eine ich du er sie es nicht zu mit den dem des auf für wir ihr sind',
  'it-IT': 'il lo la gli le di che e è un una per non sono io tu lui lei con del della mi ti',
  'pt-BR': 'o a os as de que e é um uma não em do da por com para eu você ele ela isso muito',
  'nl-NL': 'de het een en is van ik je jij hij zij wij niet dat die op te met voor zijn',
  'tr-TR': 've bir bu ne ben sen o biz siz çok da de mi mı mu mü için ile var yok değil nasıl',
  'pl-PL': 'i w nie na się jest to że z do co jak tak ja ty on ona my',
  'sv-SE': 'och är en ett det att jag du han hon inte på med för som vi',
  'da-DK': 'og er en et det at jeg du han hun ikke på med for som vi',
  'nb-NO': 'og er en et det å jeg du han hun ikke på med for som vi',
  'id-ID': 'dan yang di ini itu saya kamu dia tidak ada dengan untuk apa ke dari',
  'vi-VN': 'và là của có không tôi bạn này một những được cho với',
  'ro-RO': 'și este un o de la nu în cu pe eu tu el ea că ce',
  'cs-CZ': 'a je to v na se že s z do jak ne já ty on ona',
  'hu-HU': 'a az és egy nem van hogy is én te ő mi meg ez',
  'fi-FI': 'ja on ei se että minä sinä hän me te mitä kuin',
  'sw-KE': 'na ya wa ni kwa la za katika hii mimi wewe yeye',
  la: 'et est in non ad cum sed quod ut ego tu',
};

// Letters that point to a language.
const LETTERS: [RegExp, string, number][] = [
  [/[ışğİ]/g, 'tr-TR', 3],
  [/[ñ¿¡]/g, 'es-ES', 3],
  [/[ãõ]/g, 'pt-BR', 3],
  [/[ß]/g, 'de-DE', 3],
  [/[äöü]/g, 'de-DE', 0.6],
  [/[äöü]/g, 'tr-TR', 0.3],
  [/[äö]/g, 'fi-FI', 0.5],
  [/[àâæçéèêëîïôœùûÿ]/g, 'fr-FR', 0.8],
  [/[àèéìòù]/g, 'it-IT', 0.5],
  [/[ąćęłńśźż]/g, 'pl-PL', 3],
  [/[åæø]/g, 'da-DK', 1],
  [/[å]/g, 'sv-SE', 1],
  [/[ăâîșțşţ]/g, 'ro-RO', 2],
  [/[čďěňřšťůž]/g, 'cs-CZ', 2],
  [/[őű]/g, 'hu-HU', 3],
  [/[ơưđ]|[ạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/g, 'vi-VN', 3],
];

// Writing systems: one language each, or the most likely one.
const SCRIPTS: [RegExp, string][] = [
  [/[぀-ヿ]/g, 'ja-JP'],
  [/[가-힯ᄀ-ᇿ]/g, 'ko-KR'],
  [/[一-鿿]/g, 'zh-CN'],
  [/[Ѐ-ӿ]/g, 'ru-RU'],
  [/[Ͱ-Ͽ]/g, 'el-GR'],
  [/[֐-׿]/g, 'he-IL'],
  [/[؀-ۿ]/g, 'ar-SA'],
  [/[ऀ-ॿ]/g, 'hi-IN'],
  [/[฀-๿]/g, 'th-TH'],
  [/[԰-֏]/g, 'hy-AM'],
  [/[Ⴀ-ჿ]/g, 'ka-GE'],
  [/[ঀ-৿]/g, 'bn-IN'],
  [/[஀-௿]/g, 'ta-IN'],
];

const wordSets = Object.fromEntries(Object.entries(WORDS).map(([k, v]) => [k, new Set(v.split(' '))]));

function plain(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[sound:[^\]]+\]/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\{\{c\d+::([^}]*?)(::[^}]*)?\}\}/g, '$1');
}

/**
 * The most likely language of some texts (a field's text across many cards),
 * or '' when it cannot be told with enough certainty.
 */
export function detectLanguage(texts: string[]): string {
  const sample = texts.slice(0, 400).map(plain).join('\n');
  if (!sample.trim()) return '';
  const letters = (sample.match(/\p{L}/gu) ?? []).length;
  if (!letters) return '';
  // Writing systems other than Latin decide by themselves.
  let best = '';
  let bestN = 0;
  for (const [re, lang] of SCRIPTS) {
    const n = (sample.match(re) ?? []).length;
    if (n > bestN) [best, bestN] = [lang, n];
  }
  if (bestN / letters > 0.3) {
    // Russian and Ukrainian share an alphabet: Ukrainian has its own letters.
    if (best === 'ru-RU' && /[іїєґ]/i.test(sample)) return 'uk-UA';
    // Japanese uses Chinese characters with kana: kana decides.
    if (best === 'zh-CN' && /[぀-ヿ]/.test(sample)) return 'ja-JP';
    return best;
  }
  const score: Score = {};
  const lower = sample.toLocaleLowerCase();
  const words = lower.match(/\p{L}+/gu) ?? [];
  for (const w of words) for (const [lang, set] of Object.entries(wordSets)) if (set.has(w)) score[lang] = (score[lang] ?? 0) + 1;
  for (const [re, lang, weight] of LETTERS) {
    const n = (lower.match(re) ?? []).length;
    if (n) score[lang] = (score[lang] ?? 0) + n * weight;
  }
  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return '';
  const [top, topScore] = ranked[0];
  const second = ranked[1]?.[1] ?? 0;
  // Enough evidence for the size of the sample, and clearly ahead of the next.
  const enough = topScore >= Math.max(3, words.length * 0.04) && topScore >= second * 1.4;
  return enough ? top : '';
}
