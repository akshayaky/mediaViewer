import { Media, MediaHistory, MediaStatus, LocalFile, PlaybackProgress, MediaSkipSegments } from '../types/media';

export interface WatchedEpisodeArtwork {
  still?: string;
  seasonPoster?: string;
}

export interface MediaResumeTarget {
  file: LocalFile;
  season: number;
  episode: number;
  position: number;
  label: string;
  hasSavedProgress: boolean;
  title?: string;
}

export function parseEpisodeFromHistoryContext(context?: string): { season: number; episode: number } | null {
  if (!context) return null;
  const match = context.match(/(?:^|[^A-Z0-9])S0*(\d+)E0*(\d+)(?!\d)/i);
  if (match) {
    return {
      season: parseInt(match[1], 10),
      episode: parseInt(match[2], 10)
    };
  }
  return null;
}

export function calculateResumeTarget(
  media: Media,
  localFiles: LocalFile[],
  allProgress: PlaybackProgress[],
  historyList?: MediaHistory[],
  skipSegments?: MediaSkipSegments[]
): MediaResumeTarget | null {
  const activeFiles = localFiles.filter(f => f.exists);
  if (activeFiles.length === 0) return null;

  if (media.type === 'TV Series') {
    // Helper to determine if an episode's playback progress is unfinished
    const isEpisodeUnfinished = (p: PlaybackProgress): boolean => {
      if (p.is_completed || p.position_seconds <= 10) return false;
      const seg = skipSegments?.find(
        s => (s.season ?? 1) === (p.season ?? 1) && (s.episode ?? 1) === (p.episode ?? 1)
      );
      if (seg?.outro?.start && seg.outro.start > 0) {
        return p.position_seconds < seg.outro.start;
      }
      return p.duration_seconds <= 0 || (p.position_seconds / p.duration_seconds < 0.9);
    };

    // 1. Candidate 1: Unfinished in-progress episode
    const inProgressCandidates = allProgress.filter(p => {
      if (!isEpisodeUnfinished(p)) return false;
      // If historyList marks this exact episode as watched with a timestamp newer than the progress, ignore it
      if (historyList) {
        const epWatchedRecord = historyList.find(h =>
          isEpisodeCompletionStatus(h.status) &&
          isEpisodeWatched([h], p.season ?? 1, p.episode ?? 1)
        );
        if (epWatchedRecord) {
          const watchedTime = new Date(epWatchedRecord.updated_at || epWatchedRecord.created_at || epWatchedRecord.completed_at || 0).getTime();
          const progressTime = new Date(p.updated_at || 0).getTime();
          if (watchedTime >= progressTime) return false;
        }
      }
      return true;
    }).sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());

    let candidate1: { target: MediaResumeTarget; timestamp: number } | null = null;
    if (inProgressCandidates.length > 0) {
      const inProgress = inProgressCandidates[0];
      const file = activeFiles.find(f => f.season === inProgress.season && f.episode === inProgress.episode) || activeFiles[0];
      const padS = String(inProgress.season || 1).padStart(2, '0');
      const padE = String(inProgress.episode || 1).padStart(2, '0');

      const season = media.seasons?.find(s => s.season_number === inProgress.season);
      const episode = season?.episodes?.find(e => e.episode_number === inProgress.episode);

      candidate1 = {
        target: {
          file,
          season: inProgress.season || 1,
          episode: inProgress.episode || 1,
          position: inProgress.position_seconds,
          label: `Resume S${padS}E${padE}`,
          hasSavedProgress: true,
          title: episode?.name
        },
        timestamp: new Date(inProgress.updated_at || 0).getTime()
      };
    }

    // 2. Candidate 2: Next unwatched episode based on most recently completed/watched episode
    const completedMap = new Map<string, { season: number; episode: number; timestamp: number }>();

    // Completed from allProgress
    for (const p of allProgress) {
      const seg = skipSegments?.find(
        s => (s.season ?? 1) === (p.season ?? 1) && (s.episode ?? 1) === (p.episode ?? 1)
      );
      const isOutroCompleted = seg?.outro?.start && seg.outro.start > 0 && p.position_seconds >= seg.outro.start;
      const isPercentCompleted = p.duration_seconds > 0 && (p.position_seconds / p.duration_seconds >= 0.9);
      if (p.is_completed || isOutroCompleted || isPercentCompleted) {
        const s = p.season || 1;
        const e = p.episode || 1;
        const key = `${s}_${e}`;
        const timestamp = new Date(p.updated_at || 0).getTime();
        const existing = completedMap.get(key);
        if (!existing || timestamp > existing.timestamp) {
          completedMap.set(key, { season: s, episode: e, timestamp });
        }
      }
    }

    // Completed from historyList
    if (historyList) {
      for (const h of historyList) {
        if (!isEpisodeCompletionStatus(h.status)) continue;
        const parsed = parseEpisodeFromHistoryContext(h.context);
        if (parsed) {
          const key = `${parsed.season}_${parsed.episode}`;
          const timestamp = new Date(h.updated_at || h.created_at || h.completed_at || 0).getTime();
          const existing = completedMap.get(key);
          if (!existing || timestamp > existing.timestamp) {
            completedMap.set(key, { season: parsed.season, episode: parsed.episode, timestamp });
          }
        }
      }
    }

    const completedEpisodes = Array.from(completedMap.values()).sort(
      (a, b) => b.timestamp - a.timestamp || (b.season - a.season) || (b.episode - a.episode)
    );

    let candidate2: { target: MediaResumeTarget; timestamp: number } | null = null;
    if (completedEpisodes.length > 0) {
      const lastComp = completedEpisodes[0];
      const nextEp = (lastComp.episode || 1) + 1;
      const nextS = lastComp.season || 1;

      let nextFile = activeFiles.find(f => f.season === nextS && f.episode === nextEp);
      let targetS = nextS;
      let targetEp = nextEp;

      if (!nextFile) {
        targetS = nextS + 1;
        targetEp = 1;
        nextFile = activeFiles.find(f => f.season === targetS && f.episode === targetEp);
      }

      if (nextFile) {
        const padS = String(targetS).padStart(2, '0');
        const padE = String(targetEp).padStart(2, '0');

        const season = media.seasons?.find(s => s.season_number === targetS);
        const episode = season?.episodes?.find(e => e.episode_number === targetEp);

        candidate2 = {
          target: {
            file: nextFile,
            season: targetS,
            episode: targetEp,
            position: 0,
            label: `Play Next S${padS}E${padE}`,
            hasSavedProgress: false,
            title: episode?.name
          },
          timestamp: lastComp.timestamp
        };
      }
    }

    // Recency resolution: Choose between Candidate 1 and Candidate 2 based on which occurred last
    if (candidate1 && candidate2) {
      if (candidate1.timestamp >= candidate2.timestamp) {
        return candidate1.target;
      }
      return candidate2.target;
    }
    if (candidate1) return candidate1.target;
    if (candidate2) return candidate2.target;

    // 3. Fallback: First available episode
    const sorted = [...activeFiles].sort(
      (a, b) => (a.season || 0) - (b.season || 0) || (a.episode || 0) - (b.episode || 0)
    );
    const first = sorted[0];
    const s = first.season || 1;
    const ep = first.episode || 1;
    const padS = String(s).padStart(2, '0');
    const padE = String(ep).padStart(2, '0');

    const season = media.seasons?.find(season => season.season_number === s);
    const episode = season?.episodes?.find(e => e.episode_number === ep);

    return {
      file: first,
      season: s,
      episode: ep,
      position: 0,
      label: `Play S${padS}E${padE}`,
      hasSavedProgress: false,
      title: episode?.name
    };
  } else {
    // Movie / single file / VideoGame
    const movieProg = allProgress.find(p => p.season === 0 && p.episode === 0) || allProgress[0];
    const activeFile = activeFiles[0];
    const movieSeg = skipSegments?.find(s => (s.season ?? 0) === 0 && (s.episode ?? 0) === 0);

    const isMovieUnfinished = movieProg && !movieProg.is_completed && movieProg.position_seconds > 10 && (
      movieSeg?.outro?.start && movieSeg.outro.start > 0
        ? movieProg.position_seconds < movieSeg.outro.start
        : (movieProg.duration_seconds <= 0 || movieProg.position_seconds / movieProg.duration_seconds < 0.9)
    );

    if (isMovieUnfinished && movieProg) {
      const mins = Math.floor(movieProg.position_seconds / 60);
      return {
        file: activeFile,
        season: 0,
        episode: 0,
        position: movieProg.position_seconds,
        label: `Resume Movie (${mins}m)`,
        hasSavedProgress: true
      };
    }

    return {
      file: activeFile,
      season: 0,
      episode: 0,
      position: 0,
      label: `Play ${media.type === 'VideoGame' ? 'Game' : 'Movie'}`,
      hasSavedProgress: false
    };
  }
}

export function isEpisodeCompletionStatus(status: MediaStatus): boolean {
  return status === 'Finished' || status === 'Watched Episode';
}

export function isEpisodeWatched(historyList: MediaHistory[], seasonNumber: number, episodeNumber: number): boolean {
  const episodeTag = new RegExp(
    `(?:^|[^A-Z0-9])S0*${seasonNumber}E0*${episodeNumber}(?!\\d)`,
    'i'
  );

  return historyList.some(history =>
    isEpisodeCompletionStatus(history.status) &&
    Boolean(history.context && episodeTag.test(history.context))
  );
}

export function getHighQualityBackdropUrl(imageUrl?: string): string | undefined {
  return imageUrl?.replace(/(\/t\/p\/)(?:w\d+|h\d+|original)(\/)/, '$1original$2');
}

export function getLastWatchedEpisodeArtwork(media: Media, historyList: MediaHistory[]): WatchedEpisodeArtwork {
  if (media.type !== 'TV Series' || !media.seasons?.length) return {};

  const episodes = media.seasons
    .flatMap(season =>
      (season.episodes || []).map(episode => ({
        seasonNumber: season.season_number,
        seasonPoster: season.poster_path,
        episode
      }))
    )
    .sort((a, b) =>
      a.seasonNumber - b.seasonNumber ||
      a.episode.episode_number - b.episode.episode_number
    );
  if (!episodes.length) return {};
  if (!episodes.length) return {};

  const watchedHistory = historyList
    .filter(history => isEpisodeCompletionStatus(history.status) && history.context)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const lastWatchedEpisode = watchedHistory
    .map(history => episodes.find(({ seasonNumber, episode }) =>
      isEpisodeWatched([history], seasonNumber, episode.episode_number)
    ))
    .find(episode => episode !== undefined);

  return {
    still: lastWatchedEpisode?.episode.still_path,
    seasonPoster: lastWatchedEpisode?.seasonPoster
  };
}
