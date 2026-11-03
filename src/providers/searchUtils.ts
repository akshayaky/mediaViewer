export async function searchWithProgressiveTrim<T>(
  rawQuery: string,
  cleanQuery: string,
  search: (query: string) => Promise<T[]>
): Promise<T[]> {
  const words = (cleanQuery || rawQuery).split(/\s+/).filter(Boolean);

  for (let length = words.length; length >= 1; length--) {
    const results = await search(words.slice(0, length).join(' '));
    if (results.length > 0) return results;
  }

  return [];
}
