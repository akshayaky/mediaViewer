import { describe, expect, it } from 'vitest';
import {
  parseMediaTextFilter,
  matchesMediaTextFilter,
  SEARCH_FILTER_DEFINITIONS
} from '../services/MediaTextFilter';
import { Media } from '../types/media';

const createMedia = (partial: Partial<Media>): Media => ({
  id: partial.id || 'media-1',
  type: partial.type || 'Film',
  title: partial.title || 'Inception',
  release_year: partial.release_year ?? 2010,
  language: partial.language || 'en',
  genres: partial.genres || ['Action', 'Sci-Fi'],
  runtime: partial.runtime ?? 148,
  created_at: partial.created_at || '2023-01-01T00:00:00.000Z',
  updated_at: partial.updated_at || '2023-01-01T00:00:00.000Z',
  publisher: partial.publisher,
  developer: partial.developer,
  cast: partial.cast || [
    { id: '1', name: 'Leonardo DiCaprio' },
    { id: '2', name: 'Joseph Gordon-Levitt' }
  ]
});

describe('Universal Search Filters & Discovery', () => {
  it('exposes all required search filter definitions with syntax and scopes', () => {
    const keys = SEARCH_FILTER_DEFINITIONS.map(d => d.key);
    expect(keys).toContain('type');
    expect(keys).toContain('genre');
    expect(keys).toContain('year');
    expect(keys).toContain('language');
    expect(keys).toContain('status');
    expect(keys).toContain('rating');
    expect(keys).toContain('cast');
    expect(keys).toContain('publisher');
    expect(keys).toContain('developer');
    expect(keys).toContain('runtime');
    expect(keys).toContain('added');
    expect(keys).toContain('watched');
    expect(keys).toContain('local');

    // External scope contains only supported external filters
    const externalDefs = SEARCH_FILTER_DEFINITIONS.filter(d => d.scopes.includes('external'));
    const externalKeys = externalDefs.map(d => d.key);
    expect(externalKeys).toEqual(['year', 'language', 'cast']);

    // Library scope contains all filters
    const libraryDefs = SEARCH_FILTER_DEFINITIONS.filter(d => d.scopes.includes('library'));
    expect(libraryDefs.length).toBe(13);
  });

  it('filters available definitions when typing after slash', () => {
    const filterDefs = (prefix: string, scope: 'library' | 'external' = 'library') => {
      const available = SEARCH_FILTER_DEFINITIONS.filter(d => d.scopes.includes(scope));
      if (!prefix) return available;
      const q = prefix.toLowerCase();
      return available.filter(
        d =>
          d.key.toLowerCase().startsWith(q) ||
          d.syntax.toLowerCase().startsWith(q) ||
          d.label.toLowerCase().split(' ').some(word => word.startsWith(q))
      );
    };

    expect(filterDefs('gen').map(d => d.key)).toEqual(['genre']);
    expect(filterDefs('y').map(d => d.key)).toEqual(['year']);
    expect(filterDefs('stat').map(d => d.key)).toEqual(['status']);
    expect(filterDefs('dev').map(d => d.key)).toEqual(['developer']);
    expect(filterDefs('pub').map(d => d.key)).toEqual(['publisher']);
    expect(filterDefs('nonexistent').length).toBe(0);
  });

  it('correctly simulates filter insertion replacing the slash trigger', () => {
    const insertFilter = (currentValue: string, syntax: string, optionValue?: string) => {
      const textToInsert = optionValue ? `${syntax}${optionValue} ` : syntax;
      const trailingSlashIndex = currentValue.lastIndexOf('/');
      if (trailingSlashIndex >= 0) {
        const beforeSlash = currentValue.slice(0, trailingSlashIndex);
        return beforeSlash ? `${beforeSlash.trimEnd()} ${textToInsert}` : textToInsert;
      }
      return currentValue.trim() ? `${currentValue.trim()} ${textToInsert}` : textToInsert;
    };

    expect(insertFilter('/', 'genre:')).toBe('genre:');
    expect(insertFilter('/gen', 'genre:')).toBe('genre:');
    expect(insertFilter('Batman /', 'year:')).toBe('Batman year:');
    expect(insertFilter('Batman /y', 'year:')).toBe('Batman year:');
    expect(insertFilter('type:movie /', 'status:')).toBe('type:movie status:');
    expect(insertFilter('/', 'type:', 'movie')).toBe('type:movie ');
    expect(insertFilter('Inception /', 'rating:', '5')).toBe('Inception rating:5 ');
  });

  it('ensures slash discovery and bare filter prefix do not trigger free-text query searches', () => {
    // Typing '/' should not produce a query search for literal '/'
    expect(parseMediaTextFilter('/').query).toBe('');
    expect(parseMediaTextFilter('/gen').query).toBe('');
    expect(parseMediaTextFilter('/type').query).toBe('');

    // Suffixing '/' onto existing query preserves previous query without '/'
    expect(parseMediaTextFilter('Inception /').query).toBe('Inception');
    expect(parseMediaTextFilter('Dune /y').query).toBe('Dune');

    // Bare filter prefixes without a value yet do not search for the prefix name
    expect(parseMediaTextFilter('type:').query).toBe('');
    expect(parseMediaTextFilter('genre:').query).toBe('');
    expect(parseMediaTextFilter('Inception status:').query).toBe('Inception');
  });

  it('provides dedicated filter value options for type, genre, status, and rating', async () => {
    const { FILTER_VALUE_OPTIONS } = await import('../components/HighlightedFilterInput');

    expect(FILTER_VALUE_OPTIONS.type.map(o => o.value)).toEqual(['movie', 'show', 'game']);
    expect(FILTER_VALUE_OPTIONS.status.map(o => o.value)).toContain('finished');
    expect(FILTER_VALUE_OPTIONS.status.map(o => o.value)).toContain('watching');
    expect(FILTER_VALUE_OPTIONS.status.map(o => o.value)).toContain('planned');
    expect(FILTER_VALUE_OPTIONS.rating.map(o => o.value)).toContain('5');
    expect(FILTER_VALUE_OPTIONS.rating.map(o => o.value)).toContain('4');
    expect(FILTER_VALUE_OPTIONS.rating.map(o => o.value)).toContain('>3');
    expect(FILTER_VALUE_OPTIONS.genre.map(o => o.value)).toContain('Action');
    expect(FILTER_VALUE_OPTIONS.genre.map(o => o.value)).toContain('Sci-Fi');
    expect(FILTER_VALUE_OPTIONS.local.map(o => o.value)).toEqual(['available', 'missing', 'none']);
  });

  it('supports combining multiple diverse search filters', () => {
    const query = 'type:movie year:2010 genre:Sci-Fi cast:Leonardo-DiCaprio rating:>4 runtime:>120 Inception';
    const parsed = parseMediaTextFilter(query);

    expect(parsed.query).toBe('Inception');
    expect(parsed.filters.length).toBe(6);

    const mediaItem = createMedia({
      type: 'Film',
      release_year: 2010,
      genres: ['Action', 'Sci-Fi'],
      runtime: 148,
      cast: [{ id: '1', name: 'Leonardo DiCaprio' }]
    });

    const enriched = {
      ...mediaItem,
      status: 'Finished',
      rating: 5
    };

    expect(matchesMediaTextFilter(enriched, parsed.filters)).toBe(true);

    // If one filter doesn't match, combination fails
    const wrongYear = { ...enriched, release_year: 2011 };
    expect(matchesMediaTextFilter(wrongYear, parsed.filters)).toBe(false);

    const wrongGenre = { ...enriched, genres: ['Comedy'] };
    expect(matchesMediaTextFilter(wrongGenre, parsed.filters)).toBe(false);
  });
});

describe('Metadata Tags to Global Search Syntax', () => {
  const getTypeFilter = (type: Media['type']) => {
    if (type === 'Film') return 'type:movie';
    if (type === 'TV Series') return 'type:show';
    return 'type:game';
  };

  const getGenreFilter = (genre: string) => `genre:${genre.trim().replace(/\s+/g, '-')}`;
  const getYearFilter = (year: number) => `year:${year}`;
  const getLanguageFilter = (lang: string) => `lang:${lang.toLowerCase()}`;
  const getPublisherFilter = (pub: string) => `publisher:${pub.trim().replace(/\s+/g, '-')}`;
  const getDeveloperFilter = (dev: string) => `developer:${dev.trim().replace(/\s+/g, '-')}`;
  const getCastFilter = (name: string) => `cast:${name.trim().replace(/\s+/g, '-')}`;

  it('generates valid search filter queries for each metadata tag', () => {
    expect(getTypeFilter('Film')).toBe('type:movie');
    expect(getTypeFilter('TV Series')).toBe('type:show');
    expect(getTypeFilter('VideoGame')).toBe('type:game');

    expect(getGenreFilter('Action')).toBe('genre:Action');
    expect(getGenreFilter('Sci Fi')).toBe('genre:Sci-Fi');
    expect(getGenreFilter('Action & Adventure')).toBe('genre:Action-&-Adventure');

    expect(getYearFilter(2024)).toBe('year:2024');
    expect(getLanguageFilter('EN')).toBe('lang:en');
    expect(getLanguageFilter('ja-JP')).toBe('lang:ja-jp');

    expect(getPublisherFilter('Nintendo of America')).toBe('publisher:Nintendo-of-America');
    expect(getDeveloperFilter('FromSoftware')).toBe('developer:FromSoftware');
    expect(getCastFilter('Tom Hanks')).toBe('cast:Tom-Hanks');
  });

  it('matches media against the generated metadata filter queries', () => {
    const movie = createMedia({
      type: 'Film',
      release_year: 2024,
      genres: ['Action', 'Sci Fi'],
      language: 'English',
      cast: [{ id: '1', name: 'Tom Hanks' }]
    });

    expect(matchesMediaTextFilter(movie, parseMediaTextFilter(getTypeFilter('Film')).filters)).toBe(true);
    expect(matchesMediaTextFilter(movie, parseMediaTextFilter(getYearFilter(2024)).filters)).toBe(true);
    expect(matchesMediaTextFilter(movie, parseMediaTextFilter(getGenreFilter('Sci Fi')).filters)).toBe(true);
    expect(matchesMediaTextFilter(movie, parseMediaTextFilter(getCastFilter('Tom Hanks')).filters)).toBe(true);
    expect(matchesMediaTextFilter(movie, parseMediaTextFilter('lang:en').filters)).toBe(true);
  });

  it('accurately matches languages across ISO codes and full names without substring collision', () => {
    const englishMovie = createMedia({ title: 'Dune', language: 'English' });
    const malayalamMovie = createMedia({ title: 'Traffic', language: 'Malayalam' });
    const japaneseMovie = createMedia({ title: 'Spirited Away', language: 'Japanese' });
    const frenchMovie = createMedia({ title: 'Amelie', language: 'French' });
    const codeMovie = createMedia({ title: 'Short Film', language: 'en' });
    const localeMovie = createMedia({ title: 'US Film', language: 'en-US' });

    // lang:en should match English, en, en-US
    const enFilter = parseMediaTextFilter('lang:en').filters;
    expect(matchesMediaTextFilter(englishMovie, enFilter)).toBe(true);
    expect(matchesMediaTextFilter(codeMovie, enFilter)).toBe(true);
    expect(matchesMediaTextFilter(localeMovie, enFilter)).toBe(true);
    // lang:en must NOT match French (even though "french" contains the letters "en")
    expect(matchesMediaTextFilter(frenchMovie, enFilter)).toBe(false);
    expect(matchesMediaTextFilter(malayalamMovie, enFilter)).toBe(false);

    // lang:ml matches Malayalam
    const mlFilter = parseMediaTextFilter('lang:ml').filters;
    expect(matchesMediaTextFilter(malayalamMovie, mlFilter)).toBe(true);
    expect(matchesMediaTextFilter(englishMovie, mlFilter)).toBe(false);

    // lang:ja matches Japanese
    const jaFilter = parseMediaTextFilter('lang:ja').filters;
    expect(matchesMediaTextFilter(japaneseMovie, jaFilter)).toBe(true);
    expect(matchesMediaTextFilter(frenchMovie, jaFilter)).toBe(false);
  });

  it('excludes candidates from external results when media is already present in library', () => {
    const localLibrary: Media[] = [
      createMedia({
        id: 'local-1',
        title: 'Dune',
        type: 'Film',
        external_ids: [{ id: 'ext-1', media_id: 'local-1', provider: 'TMDB', external_id: 'movie:438631' }]
      })
    ];

    const externalCandidates = [
      {
        provider: 'TMDB',
        external_id: 'movie:438631',
        title: 'Dune',
        type: 'Film' as const
      },
      {
        provider: 'TMDB',
        external_id: 'movie:999999',
        title: 'Another Movie',
        type: 'Film' as const
      }
    ];

    const filtered = externalCandidates.filter(candidate => !localLibrary.some(item =>
      (candidate.external_id && item.external_ids?.some(ext => ext.external_id === candidate.external_id))
      || (
        item.type === candidate.type
        && item.title.localeCompare(candidate.title, undefined, { sensitivity: 'base' }) === 0
      )
    ));

    // Dune should be excluded because it is already present in the local library
    expect(filtered.map(c => c.title)).toEqual(['Another Movie']);
  });
});

describe('Drag-to-Scroll Logic & Click Suppression', () => {
  it('distinguishes dragging from clicking using movement threshold', () => {
    const DRAG_THRESHOLD = 5;

    const checkDrag = (startX: number, endX: number) => {
      const delta = Math.abs(endX - startX);
      return {
        moved: delta >= DRAG_THRESHOLD,
        suppressClick: delta >= DRAG_THRESHOLD
      };
    };

    // Quick tap or click with slight pointer jitter (< 5px) -> click should NOT be suppressed
    const clickAttempt = checkDrag(100, 103);
    expect(clickAttempt.moved).toBe(false);
    expect(clickAttempt.suppressClick).toBe(false);

    // Intentional drag (> 5px) -> click MUST be suppressed
    const dragAttempt = checkDrag(100, 140);
    expect(dragAttempt.moved).toBe(true);
    expect(dragAttempt.suppressClick).toBe(true);

    // Leftward drag
    const leftDragAttempt = checkDrag(200, 150);
    expect(leftDragAttempt.moved).toBe(true);
    expect(leftDragAttempt.suppressClick).toBe(true);
  });
});
