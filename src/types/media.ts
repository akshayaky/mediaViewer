export type MediaType = 'Film' | 'TV Series' | 'VideoGame';

export type MediaStatus = 'Finished' | 'Watched Episode' | 'Currently' | 'Abandoned' | 'Planned' | 'Paused';

export interface ExternalID {
  id: string;
  media_id: string;
  provider: 'TMDB' | 'IGDB' | 'RAWG' | 'Steam' | 'Notion' | string;
  external_id: string;
}

export interface CastMember {
  id: string;
  name: string;
  character?: string;
  profile_path?: string;
}

export interface Episode {
  episode_number: number;
  name: string;
  overview?: string;
  air_date?: string;
  still_path?: string;
  vote_average?: number;
}

export interface Season {
  season_number: number;
  name: string;
  overview?: string;
  poster_path?: string;
  episode_count?: number;
  episodes?: Episode[];
}

export interface Media {
  id: string;
  type: MediaType;
  title: string;
  original_title?: string;
  release_year?: number;
  language?: string;
  description?: string;
  genres: string[];
  runtime?: number;
  poster?: string;
  backdrop?: string;
  logo?: string;
  metadata_source?: string;
  metadata_refreshed_at?: string;
  publisher?: string;
  developer?: string;
  cast?: CastMember[];
  seasons?: Season[];
  created_at: string;
  updated_at: string;
  external_ids?: ExternalID[];
  accent_color?: string;
  manually_matched?: boolean;
}

export interface MediaHistory {
  id: string;
  media_id: string;
  started_at?: string;
  completed_at?: string;
  status: MediaStatus;
  score?: number; // 1-5 scale or star rating
  thoughts?: string;
  context?: string; // "2+ Rewatch", "restart", "theater", "resync", "Season 1-2 rewatch"
  source: string; // 'Notion' | 'Manual' | 'Import'
  original_source_record_id?: string;
  created_at: string;
  updated_at?: string;
}

export interface MediaState {
  media_id: string;
  current_status: MediaStatus;
  last_watched_played?: string;
  total_watch_play_count: number;
  rewatch_count: number;
  abandoned_count: number;
  currently_watching_playing: boolean;
  first_watched_played?: string;
  most_recent_completion?: string;
}

export interface LocalFile {
  id: string;
  media_id?: string; // Optional until matched
  path: string;
  filename: string;
  extension: string;
  size: number;
  discovered_at: string;
  last_seen_at: string;
  exists: boolean;
  file_type: 'movie' | 'tv_episode' | 'game_executable' | 'other';
  launch_info?: string;
  parsed_title?: string;
  parsed_year?: number;
  season?: number;
  episode?: number;
  end_episode?: number;
}

export interface Availability {
  id: string;
  media_id: string;
  provider: string; // e.g. 'Netflix', 'Steam', 'Xbox Game Pass'
  country?: string;
  availability_type: 'Stream' | 'Buy' | 'Rent' | 'Local' | 'Subscription';
  url?: string;
  last_checked: string;
}

export interface Wishlist {
  id: string;
  media_id?: string; // link to canonical Media when matched
  title: string;
  type: MediaType;
  source: 'Google' | 'Notion' | 'Manual' | string;
  external_url?: string;
  notes?: string;
  added_at: string;
  target_release_date?: string;
  poster?: string;
}

export interface NotionRawRecord {
  id: string;
  name_raw: string;
  type_raw: string;
  watched_on_raw?: string;
  score_raw?: string;
  status_raw?: string;
  language_raw?: string;
  thoughts_raw?: string;
  publisher_raw?: string;
  imported_at: string;
  parsed_media_id?: string;
  parsed_history_id?: string;
}

export interface PlaybackProgress {
  id: string;
  media_id: string;
  season?: number;
  episode?: number;
  position_seconds: number;
  duration_seconds: number;
  updated_at: string;
  is_completed: boolean;
}

export type MediaGridSortField =
  | 'title'
  | 'release_year'
  | 'created_at'
  | 'last_watched'
  | 'completion_date'
  | 'rating'
  | 'type'
  | 'genre'
  | 'language'
  | 'status'
  | 'publisher'
  | 'developer'
  | 'runtime';

export type MediaGridGroupField =
  | 'none'
  | 'type'
  | 'release_year'
  | 'genre'
  | 'language'
  | 'status'
  | 'rating'
  | 'last_watched'
  | 'completion_date'
  | 'publisher'
  | 'developer';

export interface MediaGridPreferences {
  sortBy: MediaGridSortField;
  sortDescending: boolean;
  groupBy: MediaGridGroupField;
  groupDescending: boolean;
}

export interface AppSettings {
  movies_folder?: string;
  tv_folder?: string;
  games_folder?: string;
  country_region?: string;
  tmdb_api_key?: string;
  twitch_client_id?: string;
  twitch_client_secret?: string;
  rawg_api_key?: string;
  steam_api_key?: string;
  igdb_api_key?: string;
  notion_integration_token?: string;
  notion_database_id?: string;
  notion_oauth_client_id?: string;
  notion_field_mapping?: any;
  notion_last_sync_time?: string;
  notion_sync_errors?: string[];
  streaming_preferences?: string[];
  player_mode?: 'builtin' | 'os_default';
  autoplay_next_episode?: boolean;
  sidebar_hide_enabled?: boolean;
  ui_preferences?: UiPreferences;
  media_grid_preferences?: MediaGridPreferences;
  player_audio_settings?: {
    volume: number;
    muted: boolean;
  };
  player_subtitle_style?: SubtitleStyleSettings;
}

export type MediaCardOrientation = 'portrait' | 'landscape';

export interface UiPreferences {
  home_card_orientation?: MediaCardOrientation;
  card_orientation_by_type: Partial<Record<MediaType, MediaCardOrientation>>;
}

export interface SubtitleStyleSettings {
  preset: 'default' | 'high-contrast' | 'large-text' | 'minimal' | 'custom';
  fontSize: number;
  fontFamily: string;
  textColor: string;
  background: 'none' | 'semi-transparent' | 'solid';
  outline: boolean;
}
