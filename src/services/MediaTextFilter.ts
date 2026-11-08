import { Media, MediaType } from '../types/media';

export type MediaFilterTarget = Pick<Media, 'type' | 'release_year' | 'language' | 'cast'>;

type YearFilter =
  | { kind: 'year'; operator: 'equal' | 'range' | 'greaterThan' | 'lessThan'; minimum: number; maximum?: number }
  | { kind: 'type'; types: MediaType[] }
  | { kind: 'language'; language: string }
  | { kind: 'cast'; cast: string };

export interface ParsedMediaTextFilter {
  query: string;
  filters: YearFilter[];
  tokens: Array<{
    text: string;
    status: 'valid' | 'invalid' | 'unsupported' | 'query';
  }>;
}

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

function parseFilterToken(token: string): YearFilter | null {
  const yearComparison = /^y:([<>])(\d{4})$/i.exec(token);
  if (yearComparison) {
    const year = Number(yearComparison[2]);
    return {
      kind: 'year',
      operator: yearComparison[1] === '>' ? 'greaterThan' : 'lessThan',
      minimum: year
    };
  }

  const yearValue = /^y:(\d{4})(?:-(\d{4}))?$/i.exec(token);
  if (yearValue) {
    const firstYear = Number(yearValue[1]);
    const secondYear = yearValue[2] ? Number(yearValue[2]) : undefined;
    return secondYear === undefined
      ? { kind: 'year', operator: 'equal', minimum: firstYear }
      : {
          kind: 'year',
          operator: 'range',
          minimum: Math.min(firstYear, secondYear),
          maximum: Math.max(firstYear, secondYear)
        };
  }

  const typeValue = /^type:(movie|show|series|game|video|film|tv|videogame|tvseries)$/i.exec(token);
  if (typeValue) {
    return { kind: 'type', types: TYPE_FILTERS[typeValue[1].toLowerCase()] };
  }

  const languageValue = /^lang:([a-z]+(?:-[A-Z]{2})?)$/i.exec(token);
  if (languageValue) {
    return { kind: 'language', language: languageValue[1].toLowerCase() };
  }

  const castValue = /^cast:(.+)$/i.exec(token);

  if (castValue) {
    // Captures the string and replaces all dashes (-) with a regular space
    const castName = castValue[1].replace(/-/g, ' ').trim();
    return { kind: 'cast', cast: castName };
  }

  return null;
}

export function parseMediaTextFilter(text: string): ParsedMediaTextFilter {
  const filters: YearFilter[] = [];
  let remainingQuery = '';
  const tokens: ParsedMediaTextFilter['tokens'] = [];

  for (const token of text.match(/\s+|\S+/g) || []) {
    if (/^\s+$/.test(token)) {
      tokens.push({ text: token, status: 'query' });
      if (remainingQuery) remainingQuery += token;
      continue;
    }

    const filter = parseFilterToken(token);
    if (filter) {
      filters.push(filter);
      tokens.push({ text: token, status: 'valid' });
    } else if (/^(?:y|type):/i.test(token)) {
      remainingQuery += token;
      tokens.push({ text: token, status: 'invalid' });
    } else if (/^[a-z][\w-]*:/i.test(token)) {
      remainingQuery += token;
      tokens.push({ text: token, status: 'unsupported' });
    } else {
      remainingQuery += token;
      tokens.push({ text: token, status: 'query' });
    }
  }

  return { query: remainingQuery.replace(/\s+/g, ' ').trim(), filters, tokens };
}

export function matchesMediaTextFilter(media: MediaFilterTarget, filters: YearFilter[]): boolean {
  return filters.every(filter => {
    if (filter.kind === 'type') return filter.types.includes(media.type);
    if (filter.kind === 'language') {
      const mediaLang = media.language?.toLowerCase() ?? '';
      const filterLang = filter.language.toLowerCase();
      // console.log('Filtering by language:', filter.language, 'Media language:', mediaLang);
      
      return mediaLang === filterLang;
    }
    if(filter.kind === 'cast') {
      // Assuming media has a cast property which is an array of strings (cast member names)
      // This is a placeholder; you may need to adjust based on your actual Media type definition
      const mediaCast = media.cast || [];
      return mediaCast.some(castMember => castMember.name.toLowerCase().includes(filter.cast.toLowerCase()));
    }
    // if (filter.kind === 'language') return media.language?.toLowerCase() === filter.language;
    if (media.release_year === undefined) return false;
    if (filter.kind === 'year') {
      switch (filter.operator) {
        case 'equal':
          return media.release_year === filter.minimum;
        case 'range':
          return media.release_year >= filter.minimum && media.release_year <= (filter.maximum ?? filter.minimum);
        case 'greaterThan':
          return media.release_year > filter.minimum;
        case 'lessThan':
          return media.release_year < filter.minimum;
      }
    }
  });
}