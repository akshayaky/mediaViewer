import { describe, expect, it, vi } from 'vitest';
import { searchWithProgressiveTrim } from '../providers/searchUtils';

describe('searchWithProgressiveTrim', () => {
  it('tries progressively shorter cleaned queries and returns the first match', async () => {
    const search = vi.fn(async (query: string) => query === 'Dune' ? ['result'] : []);

    const results = await searchWithProgressiveTrim('Dune 2024', 'Dune 2024', search);

    expect(results).toEqual(['result']);
    expect(search.mock.calls.map(([query]) => query)).toEqual(['Dune 2024', 'Dune']);
  });

  it('returns no results without issuing a request for an empty query', async () => {
    const search = vi.fn(async () => ['result']);

    await expect(searchWithProgressiveTrim('   ', '', search)).resolves.toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });
});
