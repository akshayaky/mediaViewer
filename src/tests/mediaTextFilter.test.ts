import { describe, expect, it } from 'vitest';
import { Media } from '../types/media';
import { matchesMediaTextFilter, parseMediaTextFilter } from '../services/MediaTextFilter';

const media = (type: Media['type'], release_year: number, language?: string): Media => ({
  id: `${type}-${release_year}`,
  type,
  title: 'Example',
  release_year,
  language,
  genres: [],
  created_at: '',
  updated_at: ''
});

describe('advanced media text filters', () => {
  it('parses filters regardless of their order and keeps remaining query text', () => {
    const parsed = parseMediaTextFilter('type:game Example y:2000-2010');

    expect(parsed.query).toBe('Example');
    expect(matchesMediaTextFilter(media('VideoGame', 2008), parsed.filters)).toBe(true);
    expect(matchesMediaTextFilter(media('Film', 2008), parsed.filters)).toBe(false);
    expect(matchesMediaTextFilter(media('VideoGame', 2011), parsed.filters)).toBe(false);
  });

  it('supports exact years, ranges, and strict year comparisons', () => {
    expect(matchesMediaTextFilter(media('Film', 2008), parseMediaTextFilter('y:2008').filters)).toBe(true);
    expect(matchesMediaTextFilter(media('Film', 2008), parseMediaTextFilter('y:2000-2010').filters)).toBe(true);
    expect(matchesMediaTextFilter(media('Film', 2008), parseMediaTextFilter('y:>2008').filters)).toBe(false);
    expect(matchesMediaTextFilter(media('Film', 2009), parseMediaTextFilter('y:>2008').filters)).toBe(true);
    expect(matchesMediaTextFilter(media('Film', 2010), parseMediaTextFilter('y:<2010').filters)).toBe(false);
  });

  it('supports all media type aliases and leaves malformed operators as text', () => {
    expect(matchesMediaTextFilter(media('Film', 2020), parseMediaTextFilter('type:video').filters)).toBe(true);
    expect(matchesMediaTextFilter(media('TV Series', 2020), parseMediaTextFilter('type:show').filters)).toBe(true);
    expect(matchesMediaTextFilter(media('VideoGame', 2020), parseMediaTextFilter('type:game').filters)).toBe(true);
    expect(parseMediaTextFilter('y:20 type:books').query).toBe('y:20 type:books');
    expect(parseMediaTextFilter('y:2010-2000').filters).toHaveLength(1);
    expect(matchesMediaTextFilter(media('Film', 2005), parseMediaTextFilter('y:2010-2000').filters)).toBe(true);
  });

  it('matches cast filters with actor names containing spaces', () => {
    const film = {
      ...media('Film', 2020),
      cast: [{ id: 'actor-1', name: 'Jane Doe' }]
    };

    expect(matchesMediaTextFilter(film, parseMediaTextFilter('cast:Jane-Doe').filters)).toBe(true);
    expect(matchesMediaTextFilter(film, parseMediaTextFilter('cast:John-Smith').filters)).toBe(false);
  });

  it('classifies valid, invalid, unsupported, and ordinary query tokens for highlighting', () => {
    const parsed = parseMediaTextFilter('Dune y:2008 type:book status:finished');

    expect(parsed.query).toBe('Dune type:book status:finished');
    expect(parsed.tokens.map(token => [token.text, token.status])).toEqual([
      ['Dune', 'query'],
      [' ', 'query'],
      ['y:2008', 'valid'],
      [' ', 'query'],
      ['type:book', 'invalid'],
      [' ', 'query'],
      ['status:finished', 'unsupported']
    ]);
  });

  it('normalizes remaining query spacing when filters are interleaved', () => {
    expect(parseMediaTextFilter('Dune y:2008  Part Two').query).toBe('Dune Part Two');
  });

  it('combines multiple operators as intersections', () => {
    const filters = parseMediaTextFilter('type:movie y:>2000 y:<2010').filters;

    expect(matchesMediaTextFilter(media('Film', 2005), filters)).toBe(true);
    expect(matchesMediaTextFilter(media('Film', 2010), filters)).toBe(false);
    expect(matchesMediaTextFilter(media('VideoGame', 2005), filters)).toBe(false);
  });

  it('supports language filters', () => {
    // Test valid language filter
    const englishFilm = media('Film', 2020, 'en');
    const frenchShow = media('TV Series', 2020, 'fr');
    
    const langFilter = parseMediaTextFilter('lang:en');
    expect(langFilter.filters).toHaveLength(1);
    expect(langFilter.filters[0].kind).toBe('language');
    // expect(langFilter.filters[0].language).toBe('en');
    
    // Should match English media
    expect(matchesMediaTextFilter(englishFilm, langFilter.filters)).toBe(true);
    // Should not match French media
    expect(matchesMediaTextFilter(frenchShow, langFilter.filters)).toBe(false);
    
    // Test case insensitivity
    const langFilter2 = parseMediaTextFilter('LANG:EN');
    expect(matchesMediaTextFilter(englishFilm, langFilter2.filters)).toBe(true);
    
    // Test with language code validation (two-letter code)
    const langFilter3 = parseMediaTextFilter('lang:en-US');
    expect(langFilter3.filters).toHaveLength(1);
    // expect(langFilter3.filters[0].language).toBe('en-us');
    
    // Test invalid language format (should be unsupported)
    const invalidLangFilter = parseMediaTextFilter('lang:english');
    expect(invalidLangFilter.filters).toHaveLength(0); // Should not be parsed as valid
  });
});