import { Media, MediaType } from '../types/media';

export type MediaFilterTarget = Partial<Media> & {
  status?: string;
  rating?: number;
  score?: number;
  last_watched?: string;
  last_watched_played?: string;
  local_files?: Array<{ exists: boolean }>;
  local_status?: 'available' | 'missing' | 'none';
};

export type NumericOperator = 'equal' | 'range' | 'greaterThan' | 'lessThan';

export type YearFilter =
  | { kind: 'year'; operator: NumericOperator; minimum: number; maximum?: number }
  | { kind: 'type'; types: MediaType[] }
  | { kind: 'language'; language: string }
  | { kind: 'cast'; cast: string }
  | { kind: 'genre'; genre: string }
  | { kind: 'status'; statuses: string[] }
  | { kind: 'rating'; operator: NumericOperator; minimum: number; maximum?: number }
  | { kind: 'publisher'; publisher: string }
  | { kind: 'developer'; developer: string }
  | { kind: 'runtime'; operator: NumericOperator; minimum: number; maximum?: number }
  | { kind: 'added'; operator: NumericOperator; minimum: number; maximum?: number }
  | { kind: 'watched'; operator: NumericOperator; minimum: number; maximum?: number }
  | { kind: 'local'; value: 'available' | 'missing' | 'none' };

export type MediaFilter = YearFilter;

export interface ParsedMediaTextFilter {
  query: string;
  filters: YearFilter[];
  tokens: Array<{
    text: string;
    status: 'valid' | 'invalid' | 'unsupported' | 'query';
  }>;
}

export interface SearchFilterDefinition {
  key: string;
  syntax: string;
  label: string;
  description: string;
  examples: string[];
  options?: string[];
  scopes: Array<'library' | 'external'>;
}

export const SEARCH_FILTER_DEFINITIONS: SearchFilterDefinition[] = [
  {
    key: 'type',
    syntax: 'type:',
    label: 'Media Type',
    description: 'Filter by media type (movie, show, game)',
    examples: ['type:movie', 'type:show', 'type:game'],
    options: ['movie', 'show', 'game'],
    scopes: ['library']
  },
  {
    key: 'genre',
    syntax: 'genre:',
    label: 'Genre',
    description: 'Filter by genre name',
    examples: ['genre:Action', 'genre:Sci-Fi', 'genre:Comedy'],
    options: ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Fantasy', 'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Thriller', 'RPG'],
    scopes: ['library']
  },
  {
    key: 'year',
    syntax: 'year:',
    label: 'Release Year',
    description: 'Filter by release year (year:2024, year:2010-2020, year:>2015)',
    examples: ['year:2024', 'year:2010-2020', 'year:>2015', 'year:<2010'],
    scopes: ['library', 'external']
  },
  {
    key: 'language',
    syntax: 'lang:',
    label: 'Language',
    description: 'Filter by ISO language code (lang:en, lang:ja, lang:fr)',
    examples: ['lang:en', 'lang:ja', 'lang:fr', 'lang:es', 'lang:ko'],
    options: ['en', 'ja', 'fr', 'es', 'ko', 'de', 'it', 'ml', 'hi', 'zh'],
    scopes: ['library', 'external']
  },
  {
    key: 'status',
    syntax: 'status:',
    label: 'Watch Status',
    description: 'Filter by watch or play status (finished, watching, planned, abandoned)',
    examples: ['status:finished', 'status:watching', 'status:planned', 'status:abandoned'],
    options: ['finished', 'watching', 'planned', 'abandoned', 'paused'],
    scopes: ['library']
  },
  {
    key: 'rating',
    syntax: 'rating:',
    label: 'Rating / Score',
    description: 'Filter by rating score (rating:5, rating:>3, rating:3-5)',
    examples: ['rating:5', 'rating:>3', 'rating:3-5'],
    options: ['5', '4', '3', '2', '1'],
    scopes: ['library']
  },
  {
    key: 'cast',
    syntax: 'cast:',
    label: 'Cast Member',
    description: 'Filter by actor or cast member name',
    examples: ['cast:Tom-Hanks', 'cast:"Jane Doe"'],
    scopes: ['library', 'external']
  },
  {
    key: 'publisher',
    syntax: 'publisher:',
    label: 'Publisher',
    description: 'Filter by publisher',
    examples: ['publisher:Nintendo', 'publisher:Capcom', 'publisher:Sony'],
    scopes: ['library']
  },
  {
    key: 'developer',
    syntax: 'developer:',
    label: 'Developer',
    description: 'Filter by developer',
    examples: ['developer:Valve', 'developer:FromSoftware', 'developer:Nintendo'],
    scopes: ['library']
  },
  {
    key: 'runtime',
    syntax: 'runtime:',
    label: 'Runtime (mins)',
    description: 'Filter by duration in minutes (runtime:>120, runtime:90-120)',
    examples: ['runtime:>120', 'runtime:<90', 'runtime:90-120'],
    scopes: ['library']
  },
  {
    key: 'added',
    syntax: 'added:',
    label: 'Date Added',
    description: 'Filter by year added to library (added:2024, added:>2022)',
    examples: ['added:2024', 'added:>2022', 'added:<2025'],
    scopes: ['library']
  },
  {
    key: 'watched',
    syntax: 'watched:',
    label: 'Last Watched',
    description: 'Filter by last watched year (watched:2024, watched:>2022)',
    examples: ['watched:2024', 'watched:>2022', 'watched:<2025'],
    scopes: ['library']
  },
  {
    key: 'local',
    syntax: 'local:',
    label: 'Local Files',
    description: 'Filter by local file availability (available, missing, none)',
    examples: ['local:available', 'local:missing', 'local:none'],
    options: ['available', 'missing', 'none'],
    scopes: ['library']
  }
];

const TYPE_FILTERS: Record<string, MediaType[]> = {
  movie: ['Film'],
  film: ['Film'],
  show: ['TV Series'],
  series: ['TV Series'],
  tv: ['TV Series'],
  tvseries: ['TV Series'],
  game: ['VideoGame'],
  videogame: ['VideoGame'],
  video: ['Film', 'TV Series']
};

const STATUS_ALIASES: Record<string, string[]> = {
  finished: ['Finished'],
  watched: ['Finished'],
  completed: ['Finished'],
  watching: ['Currently', 'Watched Episode'],
  currently: ['Currently', 'Watched Episode'],
  planned: ['Planned'],
  plan: ['Planned'],
  unwatched: ['Planned'],
  unplayed: ['Planned'],
  abandoned: ['Abandoned'],
  dropped: ['Abandoned'],
  paused: ['Paused'],
  'on-hold': ['Paused']
};

export const KNOWN_FILTER_PREFIXES = [
  'y',
  'year',
  'type',
  'lang',
  'language',
  'cast',
  'genre',
  'status',
  'rating',
  'score',
  'publisher',
  'developer',
  'runtime',
  'added',
  'watched',
  'local'
];

export const LANGUAGE_CODE_TO_NAME: Record<string, string> = {
  en: 'english',
  ja: 'japanese',
  ko: 'korean',
  fr: 'french',
  es: 'spanish',
  de: 'german',
  it: 'italian',
  zh: 'chinese',
  ru: 'russian',
  pt: 'portuguese',
  ml: 'malayalam',
  hi: 'hindi',
  ta: 'tamil',
  te: 'telugu',
  kn: 'kannada',
  bn: 'bengali',
  pa: 'punjabi',
  mr: 'marathi',
  gu: 'gujarati',
  ar: 'arabic',
  sv: 'swedish',
  no: 'norwegian',
  da: 'danish',
  fi: 'finnish',
  nl: 'dutch',
  pl: 'polish',
  tr: 'turkish',
  el: 'greek',
  he: 'hebrew',
  th: 'thai',
  vi: 'vietnamese',
  id: 'indonesian',
  cs: 'czech',
  hu: 'hungarian',
  ro: 'romanian',
  uk: 'ukrainian',
  fa: 'persian'
};

export const LANGUAGE_NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(LANGUAGE_CODE_TO_NAME).map(([code, name]) => [name, code])
);

export function toLanguageCode(lang: string | undefined): string {
  if (!lang) return '';
  const normalized = lang.trim().toLowerCase();
  if (LANGUAGE_CODE_TO_NAME[normalized]) return normalized;
  if (LANGUAGE_NAME_TO_CODE[normalized]) return LANGUAGE_NAME_TO_CODE[normalized];
  const prefix = normalized.split('-')[0];
  if (LANGUAGE_CODE_TO_NAME[prefix]) return prefix;
  if (LANGUAGE_NAME_TO_CODE[prefix]) return LANGUAGE_NAME_TO_CODE[prefix];
  return normalized;
}

export function matchesLanguage(mediaLang: string | undefined, filterLang: string): boolean {
  if (!mediaLang) return false;
  const m = mediaLang.trim().toLowerCase();
  const f = filterLang.trim().toLowerCase();

  // Direct equality (e.g. "en" === "en" or "english" === "english")
  if (m === f) return true;

  // Normalized ISO code equality (e.g. "English" -> "en" === "en")
  const mCode = toLanguageCode(m);
  const fCode = toLanguageCode(f);
  if (mCode && fCode && mCode === fCode) return true;

  // Locale prefix equality (e.g. "en-US" matches "en")
  if (m.split('-')[0] === f.split('-')[0]) return true;

  // Full name equality (e.g. "English" matches "english")
  const mName = LANGUAGE_CODE_TO_NAME[m] || m;
  const fName = LANGUAGE_CODE_TO_NAME[f] || f;
  if (mName && fName && mName === fName) return true;

  return false;
}

function stripQuotes(val: string): string {
  let cleaned = val.trim();
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1);
  }
  return cleaned.trim();
}

function normalizeForSearch(str: string): string {
  return str.toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseNumericFilter(
  rawVal: string,
  kind: 'year' | 'rating' | 'runtime' | 'added' | 'watched'
): YearFilter | null {
  const isYearLike = kind === 'year' || kind === 'added' || kind === 'watched';
  const pattern = isYearLike ? '\\d{4}' : '\\d+(?:\\.\\d+)?';

  const comparison = new RegExp(`^([<>])(${pattern})$`).exec(rawVal);
  if (comparison) {
    return {
      kind,
      operator: comparison[1] === '>' ? 'greaterThan' : 'lessThan',
      minimum: Number(comparison[2])
    };
  }

  const rangeOrEqual = new RegExp(`^(${pattern})(?:-(${pattern}))?$`).exec(rawVal);
  if (rangeOrEqual) {
    const first = Number(rangeOrEqual[1]);
    const second = rangeOrEqual[2] ? Number(rangeOrEqual[2]) : undefined;
    return second === undefined
      ? { kind, operator: 'equal', minimum: first }
      : {
          kind,
          operator: 'range',
          minimum: Math.min(first, second),
          maximum: Math.max(first, second)
        };
  }
  return null;
}

function parseFilterToken(token: string): YearFilter | null {
  const colonIndex = token.indexOf(':');
  if (colonIndex <= 0) return null;

  const prefix = token.slice(0, colonIndex).toLowerCase();
  const rawValue = token.slice(colonIndex + 1);
  if (!rawValue) return null;

  if (prefix === 'y' || prefix === 'year') {
    return parseNumericFilter(rawValue, 'year');
  }

  if (prefix === 'type') {
    const lower = rawValue.toLowerCase();
    if (TYPE_FILTERS[lower]) {
      return { kind: 'type', types: TYPE_FILTERS[lower] };
    }
    return null;
  }

  if (prefix === 'lang' || prefix === 'language') {
    const languageMatch = /^([a-z]{2,3}(?:-[a-z]{2})?)$/i.exec(rawValue);
    if (languageMatch) {
      return { kind: 'language', language: languageMatch[1].toLowerCase() };
    }
    return null;
  }

  if (prefix === 'cast') {
    const castName = stripQuotes(rawValue).replace(/-/g, ' ').trim();
    return castName ? { kind: 'cast', cast: castName } : null;
  }

  if (prefix === 'genre') {
    const genreName = stripQuotes(rawValue);
    return genreName ? { kind: 'genre', genre: genreName } : null;
  }

  if (prefix === 'status') {
    const statusVal = normalizeForSearch(stripQuotes(rawValue)).replace(/\s+/g, '-');
    const matched = STATUS_ALIASES[statusVal];
    if (matched) {
      return { kind: 'status', statuses: matched };
    }
    return null;
  }

  if (prefix === 'rating' || prefix === 'score') {
    return parseNumericFilter(rawValue, 'rating');
  }

  if (prefix === 'publisher') {
    const publisherName = stripQuotes(rawValue).replace(/-/g, ' ').trim();
    return publisherName ? { kind: 'publisher', publisher: publisherName } : null;
  }

  if (prefix === 'developer') {
    const developerName = stripQuotes(rawValue).replace(/-/g, ' ').trim();
    return developerName ? { kind: 'developer', developer: developerName } : null;
  }

  if (prefix === 'runtime') {
    return parseNumericFilter(rawValue, 'runtime');
  }

  if (prefix === 'added') {
    return parseNumericFilter(rawValue, 'added');
  }

  if (prefix === 'watched') {
    return parseNumericFilter(rawValue, 'watched');
  }

  if (prefix === 'local') {
    const localVal = normalizeForSearch(stripQuotes(rawValue));
    const localAliases: Record<string, 'available' | 'missing' | 'none'> = {
      available: 'available',
      yes: 'available',
      true: 'available',
      present: 'available',
      found: 'available',
      missing: 'missing',
      unavailable: 'missing',
      none: 'none',
      no: 'none',
      false: 'none'
    };
    const matched = localAliases[localVal];
    return matched ? { kind: 'local', value: matched } : null;
  }

  return null;
}

export function parseMediaTextFilter(text: string): ParsedMediaTextFilter {
  const filters: YearFilter[] = [];
  let remainingQuery = '';
  const tokens: ParsedMediaTextFilter['tokens'] = [];

  // Match tokens preserving quoted filter values: prefix:"value with spaces"
  const tokenRegex = /(?:[a-zA-Z0-9_-]+:"[^"]*"|[a-zA-Z0-9_-]+:'[^']*'|\S+|\s+)/g;
  const matches = text.match(tokenRegex) || [];

  for (const token of matches) {
    if (/^\s+$/.test(token)) {
      tokens.push({ text: token, status: 'query' });
      if (remainingQuery) remainingQuery += token;
      continue;
    }

    const filter = parseFilterToken(token);
    if (filter) {
      filters.push(filter);
      tokens.push({ text: token, status: 'valid' });
    } else {
      // If token is a slash discovery trigger: e.g. "/" or "/gen", don't treat it as search query
      if (/^\/[a-zA-Z0-9_-]*$/.test(token)) {
        tokens.push({ text: token, status: 'query' });
        continue;
      }

      const colonIndex = token.indexOf(':');
      if (colonIndex > 0) {
        const prefix = token.slice(0, colonIndex).toLowerCase();
        if (KNOWN_FILTER_PREFIXES.includes(prefix)) {
          // If it's a bare prefix without value (e.g. "genre:" or "type:"), don't treat as search query
          const rawValue = token.slice(colonIndex + 1);
          if (!rawValue) {
            tokens.push({ text: token, status: 'query' });
            continue;
          }
          remainingQuery += token;
          tokens.push({ text: token, status: 'invalid' });
        } else if (/^[a-z][\w-]*$/i.test(prefix)) {
          remainingQuery += token;
          tokens.push({ text: token, status: 'unsupported' });
        } else {
          remainingQuery += token;
          tokens.push({ text: token, status: 'query' });
        }
      } else {
        remainingQuery += token;
        tokens.push({ text: token, status: 'query' });
      }
    }
  }

  return { query: remainingQuery.replace(/\s+/g, ' ').trim(), filters, tokens };
}

function matchesNumeric(
  value: number,
  filter: { operator: NumericOperator; minimum: number; maximum?: number }
): boolean {
  switch (filter.operator) {
    case 'equal':
      return value === filter.minimum;
    case 'range':
      return value >= filter.minimum && value <= (filter.maximum ?? filter.minimum);
    case 'greaterThan':
      return value > filter.minimum;
    case 'lessThan':
      return value < filter.minimum;
  }
}

export function matchesMediaTextFilter(media: MediaFilterTarget, filters: YearFilter[]): boolean {
  return filters.every(filter => {
    if (filter.kind === 'type') {
      return media.type !== undefined && filter.types.includes(media.type);
    }

    if (filter.kind === 'language') {
      return matchesLanguage(media.language, filter.language);
    }

    if (filter.kind === 'cast') {
      const mediaCast = media.cast || [];
      const filterCast = normalizeForSearch(filter.cast);
      return mediaCast.some(castMember =>
        normalizeForSearch(castMember.name).includes(filterCast)
      );
    }

    if (filter.kind === 'genre') {
      const mediaGenres = media.genres || [];
      const filterGenre = normalizeForSearch(filter.genre);
      return mediaGenres.some(genre =>
        normalizeForSearch(genre).includes(filterGenre)
      );
    }

    if (filter.kind === 'status') {
      const status = media.status;
      if (!status) return false;
      const normalizedStatus = normalizeForSearch(status);
      return filter.statuses.some(s => normalizeForSearch(s) === normalizedStatus);
    }

    if (filter.kind === 'rating') {
      const rating = media.rating ?? media.score;
      if (rating === undefined || rating === null) return false;
      return matchesNumeric(rating, filter);
    }

    if (filter.kind === 'publisher') {
      if (!media.publisher) return false;
      return normalizeForSearch(media.publisher).includes(normalizeForSearch(filter.publisher));
    }

    if (filter.kind === 'developer') {
      if (!media.developer) return false;
      return normalizeForSearch(media.developer).includes(normalizeForSearch(filter.developer));
    }

    if (filter.kind === 'runtime') {
      if (media.runtime === undefined || media.runtime === null) return false;
      return matchesNumeric(media.runtime, filter);
    }

    if (filter.kind === 'added') {
      if (!media.created_at) return false;
      const year = new Date(media.created_at).getFullYear();
      if (isNaN(year)) return false;
      return matchesNumeric(year, filter);
    }

    if (filter.kind === 'watched') {
      const dateStr = media.last_watched ?? media.last_watched_played;
      if (!dateStr) return false;
      const year = new Date(dateStr).getFullYear();
      if (isNaN(year)) return false;
      return matchesNumeric(year, filter);
    }

    if (filter.kind === 'year') {
      if (media.release_year === undefined) return false;
      return matchesNumeric(media.release_year, filter);
    }

    if (filter.kind === 'local') {
      const localStatus = media.local_status ?? (
        media.local_files
          ? (media.local_files.some(file => file.exists)
              ? 'available'
              : (media.local_files.length > 0 ? 'missing' : 'none'))
          : undefined
      );
      if (!localStatus) return false;
      return localStatus === filter.value;
    }

    return true;
  });
}
