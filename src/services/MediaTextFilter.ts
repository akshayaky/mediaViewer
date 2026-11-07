import { Media, MediaType } from '../types/media';

export type MediaFilterTarget = Pick<Media, 'type' | 'release_year'>;

type YearFilter =
  | { kind: 'year'; operator: 'equal' | 'range' | 'greaterThan' | 'lessThan'; minimum: number; maximum?: number }
  | { kind: 'type'; types: MediaType[] };

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
  show: ['TV Series'],
  game: ['VideoGame'],
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

  const typeValue = /^type:(movie|show|game|video)$/i.exec(token);
  if (typeValue) {
    return { kind: 'type', types: TYPE_FILTERS[typeValue[1].toLowerCase()] };
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
    if (media.release_year === undefined) return false;

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
  });
}
