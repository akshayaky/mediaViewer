import { Media, MediaHistory } from '../types/media';

export interface WatchedEpisodeArtwork {
  still?: string;
  seasonPoster?: string;
}

export function isEpisodeWatched(historyList: MediaHistory[], seasonNumber: number, episodeNumber: number): boolean {
  const episodeTag = new RegExp(
    `(?:^|[^A-Z0-9])S0*${seasonNumber}E0*${episodeNumber}(?!\\d)`,
    'i'
  );

  return historyList.some(history =>
    history.status === 'Finished' &&
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
    .filter(history => history.status === 'Finished' && history.context)
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
