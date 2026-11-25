import { describe, expect, it } from 'vitest';
import {
  calculateResumeTarget,
  getHighQualityBackdropUrl,
  getLastWatchedEpisodeArtwork,
  isEpisodeWatched
} from '../helper/episodeProgress';
import { LocalFile, Media, MediaHistory, PlaybackProgress, MediaSkipSegments } from '../types/media';

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

  it('recognizes the Watched Episode status while preserving legacy Finished logs', () => {
    const watched = { ...watchedEpisode(1, 1), status: 'Watched Episode' as const };
    expect(isEpisodeWatched([watched], 1, 1)).toBe(true);
    expect(isEpisodeWatched([watchedEpisode(1, 1)], 1, 1)).toBe(true);
  });

  it('uses Watched Episode logs for last-watched artwork', () => {
    const watched = { ...watchedEpisode(1, 1), status: 'Watched Episode' as const };
    expect(getLastWatchedEpisodeArtwork(media, [watched])).toEqual({
      still: 's1e1.jpg',
      seasonPoster: 'season-1.jpg'
    });
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

describe('calculateResumeTarget', () => {
  const dummyFile: LocalFile = {
    id: 'f-1',
    media_id: 'film-1',
    path: '/path/to/movie.mkv',
    filename: 'movie.mkv',
    extension: 'mkv',
    size: 1000,
    discovered_at: '',
    last_seen_at: '',
    exists: true,
    file_type: 'movie'
  };

  it('returns null when no active local files exist', () => {
    const movie: Media = { id: 'film-1', type: 'Film', title: 'Movie', genres: [], created_at: '', updated_at: '' };
    expect(calculateResumeTarget(movie, [], [])).toBeNull();
    expect(calculateResumeTarget(movie, [{ ...dummyFile, exists: false }], [])).toBeNull();
  });

  it('calculates correct label and target for Movie without progress', () => {
    const movie: Media = { id: 'film-1', type: 'Film', title: 'Movie', genres: [], created_at: '', updated_at: '' };
    const target = calculateResumeTarget(movie, [dummyFile], []);
    expect(target).toEqual({
      file: dummyFile,
      season: 0,
      episode: 0,
      position: 0,
      label: 'Play Movie',
      hasSavedProgress: false
    });
  });

  it('calculates Resume Movie when saved progress exists', () => {
    const movie: Media = { id: 'film-1', type: 'Film', title: 'Movie', genres: [], created_at: '', updated_at: '' };
    const progress: PlaybackProgress = {
      id: 'p-1',
      media_id: 'film-1',
      season: 0,
      episode: 0,
      position_seconds: 360,
      duration_seconds: 7200,
      is_completed: false,
      updated_at: ''
    };
    const target = calculateResumeTarget(movie, [dummyFile], [progress]);
    expect(target?.label).toBe('Resume Movie (6m)');
    expect(target?.position).toBe(360);
    expect(target?.hasSavedProgress).toBe(true);
  });

  it('calculates correct label for TV Series when in-progress', () => {
    const epFile: LocalFile = { ...dummyFile, season: 1, episode: 2, file_type: 'tv_episode' };
    const progress: PlaybackProgress = {
      id: 'p-2',
      media_id: media.id,
      season: 1,
      episode: 2,
      position_seconds: 120,
      duration_seconds: 1800,
      is_completed: false,
      updated_at: ''
    };
    const target = calculateResumeTarget(media, [epFile], [progress]);
    expect(target?.label).toBe('Resume S01E02');
    expect(target?.position).toBe(120);
    expect(target?.hasSavedProgress).toBe(true);
  });

  it('calculates Play Next when an episode was completed', () => {
    const ep1File: LocalFile = { ...dummyFile, id: 'f-1', season: 1, episode: 1, file_type: 'tv_episode' };
    const ep2File: LocalFile = { ...dummyFile, id: 'f-2', season: 1, episode: 2, file_type: 'tv_episode' };
    const progress: PlaybackProgress = {
      id: 'p-1',
      media_id: media.id,
      season: 1,
      episode: 1,
      position_seconds: 1800,
      duration_seconds: 1800,
      is_completed: true,
      updated_at: ''
    };
    const target = calculateResumeTarget(media, [ep1File, ep2File], [progress]);
    expect(target?.label).toBe('Play Next S01E02');
    expect(target?.file.id).toBe('f-2');
    expect(target?.hasSavedProgress).toBe(false);
  });

  describe('outro detection vs 90% threshold', () => {
    const ep1File: LocalFile = { ...dummyFile, id: 'f-1', season: 1, episode: 1, file_type: 'tv_episode' };
    const ep2File: LocalFile = { ...dummyFile, id: 'f-2', season: 1, episode: 2, file_type: 'tv_episode' };

    it('treats episode at 92% duration as completed without outro, defaulting to Play Next S01E02', () => {
      const progress: PlaybackProgress = {
        id: 'p-1',
        media_id: media.id,
        season: 1,
        episode: 1,
        position_seconds: 920,
        duration_seconds: 1000,
        is_completed: false,
        updated_at: '2026-11-20T10:00:00Z'
      };
      const target = calculateResumeTarget(media, [ep1File, ep2File], [progress], [], []);
      expect(target?.label).toBe('Play Next S01E02');
    });

    it('treats episode at 92% duration as in-progress if outro begins at 95% (950s)', () => {
      const progress: PlaybackProgress = {
        id: 'p-1',
        media_id: media.id,
        season: 1,
        episode: 1,
        position_seconds: 920,
        duration_seconds: 1000,
        is_completed: false,
        updated_at: '2026-11-20T10:00:00Z'
      };
      const skipSeg: MediaSkipSegments = {
        id: 'seg-1',
        external_id: 'ext-1',
        provider: 'introdb',
        media_type: 'tv',
        season: 1,
        episode: 1,
        outro: { start: 950, end: 1000 },
        status: 'found',
        updated_at: ''
      };
      const target = calculateResumeTarget(media, [ep1File, ep2File], [progress], [], [skipSeg]);
      expect(target?.label).toBe('Resume S01E01');
      expect(target?.position).toBe(920);
    });

    it('treats episode at 85% duration as completed if outro begins earlier at 80% (800s)', () => {
      const progress: PlaybackProgress = {
        id: 'p-1',
        media_id: media.id,
        season: 1,
        episode: 1,
        position_seconds: 850,
        duration_seconds: 1000,
        is_completed: false,
        updated_at: '2026-11-20T10:00:00Z'
      };
      const skipSeg: MediaSkipSegments = {
        id: 'seg-1',
        external_id: 'ext-1',
        provider: 'introdb',
        media_type: 'tv',
        season: 1,
        episode: 1,
        outro: { start: 800, end: 1000 },
        status: 'found',
        updated_at: ''
      };
      const target = calculateResumeTarget(media, [ep1File, ep2File], [progress], [], [skipSeg]);
      expect(target?.label).toBe('Play Next S01E02');
    });
  });

  describe('recency resolution between Tier 1 (in-progress) and Tier 2 (completed next)', () => {
    const ep1File: LocalFile = { ...dummyFile, id: 'f-1', season: 1, episode: 1, file_type: 'tv_episode' };
    const ep2File: LocalFile = { ...dummyFile, id: 'f-2', season: 1, episode: 2, file_type: 'tv_episode' };
    const ep3File: LocalFile = { ...dummyFile, id: 'f-3', season: 1, episode: 3, file_type: 'tv_episode' };
    const ep4File: LocalFile = { ...dummyFile, id: 'f-4', season: 1, episode: 4, file_type: 'tv_episode' };
    const ep5File: LocalFile = { ...dummyFile, id: 'f-5', season: 1, episode: 5, file_type: 'tv_episode' };
    const allFiles = [ep1File, ep2File, ep3File, ep4File, ep5File];

    it('chooses Tier 1 (Resume) when in-progress episode was watched more recently than last completed episode', () => {
      // Completed E1 yesterday at 20:00
      const progCompletedE1: PlaybackProgress = {
        id: 'p-1',
        media_id: media.id,
        season: 1,
        episode: 1,
        position_seconds: 1800,
        duration_seconds: 1800,
        is_completed: true,
        updated_at: '2026-11-20T20:00:00Z'
      };
      // Watching E2 today at 10:00
      const progInProgressE2: PlaybackProgress = {
        id: 'p-2',
        media_id: media.id,
        season: 1,
        episode: 2,
        position_seconds: 500,
        duration_seconds: 1800,
        is_completed: false,
        updated_at: '2026-11-21T10:00:00Z'
      };

      const target = calculateResumeTarget(media, allFiles, [progCompletedE1, progInProgressE2]);
      expect(target?.label).toBe('Resume S01E02');
      expect(target?.position).toBe(500);
      expect(target?.hasSavedProgress).toBe(true);
    });

    it('chooses Tier 2 (Play Next) when another episode was completed more recently than an old in-progress episode', () => {
      // Started E1 3 weeks ago
      const progOldInProgressE1: PlaybackProgress = {
        id: 'p-1',
        media_id: media.id,
        season: 1,
        episode: 1,
        position_seconds: 400,
        duration_seconds: 1800,
        is_completed: false,
        updated_at: '2026-11-01T12:00:00Z'
      };
      // Completed E4 today at 15:00
      const progCompletedE4: PlaybackProgress = {
        id: 'p-4',
        media_id: media.id,
        season: 1,
        episode: 4,
        position_seconds: 1800,
        duration_seconds: 1800,
        is_completed: true,
        updated_at: '2026-11-21T15:00:00Z'
      };

      const target = calculateResumeTarget(media, allFiles, [progOldInProgressE1, progCompletedE4]);
      expect(target?.label).toBe('Play Next S01E05');
      expect(target?.file.id).toBe('f-5');
      expect(target?.hasSavedProgress).toBe(false);
    });

    it('chooses Tier 2 when episode was marked watched in historyList with a newer timestamp than progress', () => {
      // User paused E3 at 11:00
      const progE3: PlaybackProgress = {
        id: 'p-3',
        media_id: media.id,
        season: 1,
        episode: 3,
        position_seconds: 600,
        duration_seconds: 1800,
        is_completed: false,
        updated_at: '2026-11-21T11:00:00Z'
      };
      // User marked E3 as watched in historyList at 11:05
      const historyE3: MediaHistory = {
        id: 'h-3',
        media_id: media.id,
        status: 'Watched Episode',
        context: 'S01E03',
        source: 'Manual',
        created_at: '2026-11-21T11:05:00Z',
        updated_at: '2026-11-21T11:05:00Z'
      };

      const target = calculateResumeTarget(media, allFiles, [progE3], [historyE3]);
      expect(target?.label).toBe('Play Next S01E04');
      expect(target?.file.id).toBe('f-4');
    });
  });
});
