import { describe, expect, it } from 'vitest';
import { getNextEpisodePromptTime } from '../helper/nextEpisodePrompt';

describe('getNextEpisodePromptTime', () => {
  it('starts the next-episode prompt at the outro start when available', () => {
    expect(getNextEpisodePromptTime({ start: 1200, end: 1250 }, 1300)).toBe(1200);
  });

  it('falls back to the end-of-video threshold when there is no outro', () => {
    expect(getNextEpisodePromptTime(null, 1300)).toBe(1274);
  });
});
