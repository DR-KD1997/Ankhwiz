import { describe, expect, it } from 'vitest';
import { flagOf, langMatches, langName, nativeName, sameLang, tidyLang } from './languages';

describe('languages by name', () => {
  it('writes codes the usual way', () => {
    expect(tidyLang('es_es')).toBe('es-ES');
    expect(tidyLang('ZH-hans-cn')).toBe('zh-Hans-CN');
    expect(sameLang('pt_br', 'pt-BR')).toBe(true);
  });
  it('names languages and their countries', () => {
    expect(langName('es-ES')).toBe('Spanish (Spain)');
    expect(nativeName('es-ES')).toBe('español (España)');
    expect(langName('xx-QQ')).toBe('xx-QQ');
  });
  it('makes flags from the country, or the likely one', () => {
    expect(flagOf('es-MX')).toBe('🇲🇽');
    expect(flagOf('tr')).toBe('🇹🇷');
    expect(flagOf('la')).toBe('');
  });
  it('finds languages by other names, ignoring accents', () => {
    expect(langMatches('fa-IR', 'farsi')).toBe(true);
    expect(langMatches('pt-BR', 'brazil')).toBe(true);
    expect(langMatches('es-ES', 'espanol')).toBe(true);
    expect(langMatches('es-ES', 'german')).toBe(false);
  });
});
