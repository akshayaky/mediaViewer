import { describe, expect, it } from 'vitest';
import { getHighQualityBackdropUrl, getLastWatchedEpisodeArtwork } from '../helper/episodeProgress';
import { Media, MediaHistory } from '../types/media';

const media: Media = {
  id: 'show-1',
  type: 'TV Series',
  title: 'Example Show',
  genres: [],
  created_at: '',
  updated_at: '',
  seasons: [
    {
      season_number: 2,
      name: 'Season 2',
      poster_path: 'season-2.jpg',
      episodes: [
        { episode_number: 2, name: 'Episode 2', still_path: 's2e2.jpg' },
        { episode_number: 1, name: 'Episode 1', still_path: 's2e1.jpg' }
      ]
    },
    {
      season_number: 1,
      name: 'Season 1',
      poster_path: 'season-1.jpg',
      episodes: [
        { episode_number: 2, name: 'Episode 2', still_path: 's1e2.jpg' },
        { episode_number: 1, name: 'Episode 1', still_path: 's1e1.jpg' }
      ]
    }
  ]
};

function watchedEpisode(season: number, episode: number, createdAt = ''): MediaHistory {
  return {
    id: `${season}-${episode}`,
    media_id: media.id,
    status: 'Finished',
    context: `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`,
    source: 'Manual',
    created_at: createdAt
  };
}

describe('getLastWatchedEpisodeArtwork', () => {
  it('uses show artwork until at least one episode is watched', () => {
    expect(getLastWatchedEpisodeArtwork(media, [])).toEqual({});
  });

  it('selects the most recently watched episode, even when watched out of order', () => {
    const history = [
      watchedEpisode(1, 1, '2026-10-01T10:00:00Z'),
      watchedEpisode(2, 2, '2026-10-03T10:00:00Z'),
      watchedEpisode(1, 2, '2026-10-02T10:00:00Z')
    ];

    expect(getLastWatchedEpisodeArtwork(media, history)).toEqual({
      still: 's2e2.jpg',
      seasonPoster: 'season-2.jpg'
    });
  });

  it('does not mistake a longer episode number for the watched episode', () => {
    const mediaWithEpisodeTen: Media = {
      ...media,
      seasons: [{
        season_number: 1,
        name: 'Season 1',
        episodes: [
          { episode_number: 1, name: 'Episode 1', still_path: 's1e1.jpg' },
          { episode_number: 10, name: 'Episode 10', still_path: 's1e10.jpg' }
        ]
      }]
    };

    expect(getLastWatchedEpisodeArtwork(mediaWithEpisodeTen, [watchedEpisode(1, 1)])).toEqual({
      still: 's1e1.jpg',
      seasonPoster: undefined
    });
  });

  it('selects the latest watched episode when all episodes are watched', () => {
    const history = [
      watchedEpisode(1, 1, '2026-10-01T10:00:00Z'),
      watchedEpisode(1, 2, '2026-10-02T10:00:00Z'),
      watchedEpisode(2, 1, '2026-10-03T10:00:00Z'),
      watchedEpisode(2, 2, '2026-10-04T10:00:00Z')
    ];

    expect(getLastWatchedEpisodeArtwork(media, history)).toEqual({
      still: 's2e2.jpg',
      seasonPoster: 'season-2.jpg'
    });
  });

  it('returns no episode artwork for non-series media', () => {
    expect(getLastWatchedEpisodeArtwork({ ...media, type: 'Film' }, [])).toEqual({});
  });
});

describe('getHighQualityBackdropUrl', () => {
  it('requests the original TMDB image for backdrop use', () => {
    expect(getHighQualityBackdropUrl('https://image.tmdb.org/t/p/w300/still.jpg'))
      .toBe('https://image.tmdb.org/t/p/original/still.jpg');
  });

  it('leaves unrelated and already-original URLs unchanged', () => {
    expect(getHighQualityBackdropUrl('https://example.com/still.jpg')).toBe('https://example.com/still.jpg');
    expect(getHighQualityBackdropUrl('https://image.tmdb.org/t/p/original/still.jpg'))
      .toBe('https://image.tmdb.org/t/p/original/still.jpg');
    expect(getHighQualityBackdropUrl(undefined)).toBeUndefined();
  });
});
