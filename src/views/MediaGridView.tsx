import React, { useState, useEffect, useRef } from 'react';
import { MediaCard } from '../components/MediaCard';
import { AddMediaModal } from '../components/AddMediaModal';
import { Media, MediaCardOrientation, MediaGridGroupField, MediaGridPreferences, MediaGridSortField, MediaType } from '../types/media';
import { dbService } from '../services/DatabaseService';
import { ArrowDownUp, Search, Filter, Plus, X, RotateCcw, ChevronRight} from 'lucide-react';
import { useSidebarPadding } from '../hooks/useSidebarPadding';
import { getLastWatchedEpisodeArtwork } from '../helper/episodeProgress';
import { HorizontalDragScroll } from '../components/HorizontalDragScroll';

const DEFAULT_GRID_PREFERENCES: MediaGridPreferences = {
  sortBy: 'created_at',
  sortDescending: true,
  groupBy: 'none',
  groupDescending: false // Add default state
};

const SORT_OPTIONS: { value: MediaGridSortField; label: string }[] = [
  { value: 'title', label: 'Title' },
  { value: 'release_year', label: 'Release year' },
  { value: 'created_at', label: 'Date added' },
  { value: 'last_watched', label: 'Last watched' },
  { value: 'completion_date', label: 'Completion date' },
  { value: 'rating', label: 'Rating' },
  { value: 'type', label: 'Media type' },
  { value: 'genre', label: 'Genre' },
  { value: 'language', label: 'Language' },
  { value: 'status', label: 'Status' },
  { value: 'publisher', label: 'Publisher' },
  { value: 'developer', label: 'Developer' },
  { value: 'runtime', label: 'Runtime' }
];

const GROUP_OPTIONS: { value: MediaGridGroupField; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'type', label: 'Media type' },
  { value: 'release_year', label: 'Release year' },
  { value: 'genre', label: 'Genre' },
  { value: 'language', label: 'Language' },
  { value: 'status', label: 'Status' },
  { value: 'rating', label: 'Rating' },
  { value: 'last_watched', label: 'Last watched' },
  { value: 'completion_date', label: 'Completion date' },
  { value: 'publisher', label: 'Publisher' },
  { value: 'developer', label: 'Developer' }
];

const SORT_FIELDS = new Set<MediaGridSortField>(SORT_OPTIONS.map(option => option.value));
const GROUP_FIELDS = new Set<MediaGridGroupField>(GROUP_OPTIONS.map(option => option.value));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseDate(value: string | undefined): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

interface MediaGridViewProps {
  typeFilter?: MediaType;
  title: string;
  subtitle: string;
  onSelectMedia: (media: Media, clickedCardRect?: DOMRect) => void;
  onPreviewStart?: (media: Media, rect: DOMRect) => void;
  onPreviewEnd?: () => void;
  onAddNewMedia?: () => void;
  isCollapsed?: boolean;
  isDetailsOpen?: boolean
}

export const MediaGridView: React.FC<MediaGridViewProps> = ({
  typeFilter,
  title,
  subtitle,
  onSelectMedia,
  onPreviewStart,
  onPreviewEnd,
  onAddNewMedia,
  isCollapsed,
  isDetailsOpen
}) => {
  const { isDesktop, pagePadding } = useSidebarPadding(isCollapsed);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGenre, setSelectedGenre] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [languageFilter, setLanguageFilter] = useState<string>('All');
  const [typeFilterValue, setTypeFilterValue] = useState<string>('All');
  const [yearFilter, setYearFilter] = useState<string>('All');
  const [ratingFilter, setRatingFilter] = useState<string>('All');
  const [publisherFilter, setPublisherFilter] = useState<string>('All');
  const [developerFilter, setDeveloperFilter] = useState<string>('All');
  const [runtimeFilter, setRuntimeFilter] = useState<string>('All');
  const [watchFilter, setWatchFilter] = useState<string>('All');
  const [completionFilter, setCompletionFilter] = useState<string>('All');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isAdvancedFiltersOpen, setIsAdvancedFiltersOpen] = useState(false);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const [mediaList, setMediaList] = useState<Media[]>([]);
  const [stateByMediaId, setStateByMediaId] = useState<Record<string, Awaited<ReturnType<typeof dbService.getMediaState>>>>({});
  const [scoreByMediaId, setScoreByMediaId] = useState<Record<string, number | undefined>>({});
  const [landscapeImageByMediaId, setLandscapeImageByMediaId] = useState<Record<string, string | undefined>>({});
  const [orientationByType, setOrientationByType] = useState<Partial<Record<MediaType, MediaCardOrientation>>>({});
  const [gridPreferences, setGridPreferences] = useState<MediaGridPreferences>(DEFAULT_GRID_PREFERENCES);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [pullOffset, setPullOffset] = useState<number>(0);
  //const [crossedThreshold, setCrossedThreshold] = useState<boolean>(false);
  const crossedThresholdRef = useRef<boolean>(false);
  const preferencesLoadedRef = useRef(false);
  const preferenceChangedBeforeLoadRef = useRef(false);
  const preferenceSaveQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Add this near your state definitions
  const searchInputRef = useRef<HTMLInputElement>(null);

  const updateGridPreferences = (update: (current: MediaGridPreferences) => MediaGridPreferences) => {
    if (!preferencesLoadedRef.current) preferenceChangedBeforeLoadRef.current = true;
    setGridPreferences(update);
  };

  const refreshList = async () => {
    const media = await dbService.getAllMedia();
    const [states, histories] = await Promise.all([
      Promise.all(media.map(item => dbService.getMediaState(item.id))),
      Promise.all(media.map(item => dbService.getHistoryForMedia(item.id)))
    ]);
    setMediaList(media);
    setStateByMediaId(Object.fromEntries(states.map(state => [state.media_id, state])));
    setScoreByMediaId(Object.fromEntries(media.map((item, index) => [item.id, histories[index][0]?.score])));
    setLandscapeImageByMediaId(Object.fromEntries(media.map((item, index) => [
      item.id,
      item.type === 'TV Series'
        ? getLastWatchedEpisodeArtwork(item, histories[index]).still || item.backdrop
        : item.backdrop
    ])));
  };
  

  useEffect(() => {
    const handleScanned = () => { void refreshList(); };
    void refreshList();
    void dbService.getSettings().then(settings => {
      const saved = settings.media_grid_preferences;
      const savedOrientations = isRecord(settings.ui_preferences?.card_orientation_by_type)
        ? settings.ui_preferences.card_orientation_by_type
        : {};
      setOrientationByType({
        Film: savedOrientations.Film === 'landscape' ? 'landscape' : 'portrait',
        'TV Series': savedOrientations['TV Series'] === 'landscape' ? 'landscape' : 'portrait',
        VideoGame: savedOrientations.VideoGame === 'landscape' ? 'landscape' : 'portrait'
      });
      if (isRecord(saved) && !preferenceChangedBeforeLoadRef.current) {
        setGridPreferences({
          sortBy: typeof saved.sortBy === 'string' && SORT_FIELDS.has(saved.sortBy as MediaGridSortField)
            ? saved.sortBy as MediaGridSortField
            : DEFAULT_GRID_PREFERENCES.sortBy,
          sortDescending: typeof saved.sortDescending === 'boolean'
            ? saved.sortDescending
            : DEFAULT_GRID_PREFERENCES.sortDescending,
          groupBy: typeof saved.groupBy === 'string' && GROUP_FIELDS.has(saved.groupBy as MediaGridGroupField)
            ? saved.groupBy as MediaGridGroupField
            : DEFAULT_GRID_PREFERENCES.groupBy,
          groupDescending: typeof saved.groupDescending === 'boolean'
            ? saved.groupDescending
            : DEFAULT_GRID_PREFERENCES.groupDescending,
        });
      }
      preferencesLoadedRef.current = true;
    }).catch(error => {
      preferencesLoadedRef.current = true;
      setPreferenceError('Could not load view preferences.');
      console.error('Failed to load media view preferences:', error);
    });
    window.addEventListener('library-scanned', handleScanned);
    return () => {
      window.removeEventListener('library-scanned', handleScanned);
    };
  }, []);

  useEffect(() => {
    if (!preferencesLoadedRef.current) return;
    preferenceSaveQueueRef.current = preferenceSaveQueueRef.current
      .catch(() => undefined)
      .then(() => dbService.saveSetting('media_grid_preferences', gridPreferences))
      .then(() => setPreferenceError(null))
      .catch(error => {
        setPreferenceError('Could not save sorting and grouping preferences.');
        console.error('Failed to save media grid preferences:', error);
      });
  }, [gridPreferences]);

  useEffect(() => {
    const handleCloseSheets = (e: CustomEvent) => {
      if (isAdvancedFiltersOpen) {
        setIsAdvancedFiltersOpen(false);
        e.preventDefault();
      }
    };
    window.addEventListener('close-mobile-sheets' as any, handleCloseSheets);
    return () => {
      window.removeEventListener('close-mobile-sheets' as any, handleCloseSheets);
    };
  }, [isAdvancedFiltersOpen]);

  useEffect(() => {
    if (!isAdvancedFiltersOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!filterPanelRef.current?.contains(event.target as Node)) {
        setIsAdvancedFiltersOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsAdvancedFiltersOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAdvancedFiltersOpen]);

  // Catch over-swipe/pull down at the top of the viewport to focus search
useEffect(() => {
  if (isDetailsOpen || isAddModalOpen || isAdvancedFiltersOpen) return;
  let touchStartY = 0;
  let maxPullReached = 0;
  const SWIPE_TRIGGER_THRESHOLD = 120; // Pixels pulled before triggering focus
  const RESISTANCE_FACTOR = 0.4;       // 1:1 tracking scaled down uniformly for comfortable drag feedback

  const handleTouchStart = (e: TouchEvent) => {
    // Check if the user is at the absolute top of the page scroll
    if (window.scrollY === 0) {
      touchStartY = e.touches[0].clientY;
      maxPullReached = 0;
    } else {
      touchStartY = 0;
    }
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (touchStartY === 0) return;

    const currentY = e.touches[0].clientY;
    const rawPullDistance  = currentY - touchStartY;

   if (rawPullDistance > 0) {
      let elasticOffset = rawPullDistance * RESISTANCE_FACTOR;
      setPullOffset(elasticOffset);
      if (elasticOffset > maxPullReached) {
        maxPullReached = elasticOffset;
      } else {
        // As you move back up, it scales back down immediately at the exact same speed
        elasticOffset = Math.max(0, maxPullReached - (maxPullReached - elasticOffset));
      }
      // Trigger focus if pulled past the action barrier
      if (elasticOffset > SWIPE_TRIGGER_THRESHOLD) {
        // searchInputRef.current?.focus();
        crossedThresholdRef.current = true;
      }
      else
      {
        crossedThresholdRef.current = false;
      }
    } else if (rawPullDistance <= 0) {
      searchInputRef.current?.blur();
      setPullOffset(0);
      if(rawPullDistance < SWIPE_TRIGGER_THRESHOLD)
      {
        crossedThresholdRef.current = false;
      }
    }
  };
  
  const handleTouchEnd = () => {
    if (crossedThresholdRef.current) {
      searchInputRef.current?.focus();
    }
    // Smoothly snap the grid container back to its original layout position
    setPullOffset(0);
    crossedThresholdRef.current = false;
    touchStartY = 0;
    maxPullReached = 0;
  };

  window.addEventListener('touchstart', handleTouchStart, { passive: true });
  window.addEventListener('touchmove', handleTouchMove, { passive: true });
  window.addEventListener('touchend', handleTouchEnd, { passive: true });

  return () => {
    window.removeEventListener('touchstart', handleTouchStart);
    window.removeEventListener('touchmove', handleTouchMove);
    window.removeEventListener('touchend', handleTouchEnd);
  };
}, [isDetailsOpen, isAddModalOpen, isAdvancedFiltersOpen]);



  // Filter by media type if specified
  let items = typeFilter ? mediaList.filter(m => m.type === typeFilter) : mediaList;

  // Extract unique genres
  const genresSet = new Set<string>();
  items.forEach(m => m.genres?.forEach(g => genresSet.add(g)));
  const availableGenres = ['All', ...Array.from(genresSet)];

  // Extract unique languages
  const languageSet = new Set<string>();
  items.forEach(m => {
    if (m.language) languageSet.add(m.language);
  });
  const availableLanguages = ['All', ...Array.from(languageSet)];

  const sortedUniqueValues = (values: string[]) =>
    Array.from(new Set(values.filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
    );
  const availableYears = sortedUniqueValues(items.flatMap(media =>
    media.release_year === undefined ? [] : [String(media.release_year)]
  ));
  const availableRatings = sortedUniqueValues(items.flatMap(media => {
    const score = scoreByMediaId[media.id];
    return score === undefined ? [] : [String(score)];
  }));
  const availablePublishers = sortedUniqueValues(items.flatMap(media =>
    media.publisher ? [media.publisher] : []
  ));
  const availableDevelopers = sortedUniqueValues(items.flatMap(media =>
    media.developer ? [media.developer] : []
  ));
  const availableRuntimes = sortedUniqueValues(items.flatMap(media =>
    media.runtime === undefined ? [] : [String(media.runtime)]
  ));

  // Active filter count
  const activeFilterCount = (selectedGenre !== 'All' ? 1 : 0) +
    (statusFilter !== 'All' ? 1 : 0) +
    (languageFilter !== 'All' ? 1 : 0) +
    (typeFilterValue !== 'All' ? 1 : 0) +
    (yearFilter !== 'All' ? 1 : 0) +
    (ratingFilter !== 'All' ? 1 : 0) +
    (publisherFilter !== 'All' ? 1 : 0) +
    (developerFilter !== 'All' ? 1 : 0) +
    (runtimeFilter !== 'All' ? 1 : 0) +
    (watchFilter !== 'All' ? 1 : 0) +
    (completionFilter !== 'All' ? 1 : 0);

  // Apply search query
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    items = items.filter(
      m => m.title.toLowerCase().includes(q) || m.publisher?.toLowerCase().includes(q)
    );
  }

  // Apply genre filter
  if (selectedGenre !== 'All') {
    items = items.filter(m => m.genres?.includes(selectedGenre));
  }

  // Apply status filter
  if (statusFilter !== 'All') {
    items = items.filter(m => {
      return stateByMediaId[m.id]?.current_status === statusFilter;
    });
  }

  // Apply language filter
  if (languageFilter !== 'All') {
    items = items.filter(m => m.language?.includes(languageFilter));
  }

  if (typeFilterValue !== 'All') {
    items = items.filter(media => media.type === typeFilterValue);
  }
  if (yearFilter !== 'All') {
    items = items.filter(media => String(media.release_year ?? '') === yearFilter);
  }
  if (ratingFilter !== 'All') {
    items = items.filter(media => {
      const score = scoreByMediaId[media.id];
      return ratingFilter === 'unrated' ? score === undefined : String(score) === ratingFilter;
    });
  }
  if (publisherFilter !== 'All') {
    items = items.filter(media => media.publisher === publisherFilter);
  }
  if (developerFilter !== 'All') {
    items = items.filter(media => media.developer === developerFilter);
  }
  if (runtimeFilter !== 'All') {
    items = items.filter(media => String(media.runtime ?? '') === runtimeFilter);
  }
  if (watchFilter !== 'All') {
    items = items.filter(media => {
      const hasBeenWatched = parseDate(stateByMediaId[media.id]?.last_watched_played) !== null;
      return watchFilter === 'watched' ? hasBeenWatched : !hasBeenWatched;
    });
  }
  if (completionFilter !== 'All') {
    items = items.filter(media => {
      const hasCompleted = parseDate(stateByMediaId[media.id]?.most_recent_completion) !== null;
      return completionFilter === 'completed' ? hasCompleted : !hasCompleted;
    });
  }

  const getSortValue = (media: Media): string | number | null => {
    const state = stateByMediaId[media.id];
    switch (gridPreferences.sortBy) {
      case 'title': return media.title || null;
      case 'release_year': return media.release_year ?? null;
      case 'created_at': return parseDate(media.created_at);
      case 'last_watched': return parseDate(state?.last_watched_played);
      case 'completion_date': return parseDate(state?.most_recent_completion);
      case 'rating': return scoreByMediaId[media.id] ?? null;
      case 'type': return media.type || null;
      case 'genre': return media.genres?.[0] || null;
      case 'language': return media.language || null;
      case 'status': return state?.current_status || null;
      case 'publisher': return media.publisher || null;
      case 'developer': return media.developer || null;
      case 'runtime': return media.runtime ?? null;
    }
  };

  const compareValues = (a: string | number | null, b: string | number | null): number => {
    if (a === null || a === '') return b === null || b === '' ? 0 : 1;
    if (b === null || b === '') return -1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
  };

  const compareMedia = (a: Media, b: Media): number => {
    const aValue = getSortValue(a);
    const bValue = getSortValue(b);
    const comparison = compareValues(aValue, bValue);
    if (aValue === null || aValue === '' || bValue === null || bValue === '') {
      return comparison;
    }
    return (gridPreferences.sortDescending ? -1 : 1) * comparison
      || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  };

  const sortedItems = [...items].sort(compareMedia);
  const groupedItems = (() => {
    if (gridPreferences.groupBy === 'none') return [{ key: 'all', label: '', items: sortedItems }];

    const groups = new Map<string, { label: string; value: string | number | null; items: Media[] }>();
    const addToGroup = (media: Media, key: string, label: string, value: string | number | null) => {
      const group = groups.get(key) || { label, value, items: [] };
      group.items.push(media);
      groups.set(key, group);
    };

    sortedItems.forEach(media => {
      const state = stateByMediaId[media.id];
      switch (gridPreferences.groupBy) {
        case 'type':
          addToGroup(media, `type:${media.type}`, media.type, media.type);
          break;
        case 'release_year':
          addToGroup(media, `year:${media.release_year ?? 'unknown'}`, media.release_year ? String(media.release_year) : 'Unknown', media.release_year ?? null);
          break;
        case 'genre': {
          const genres = [...new Set(media.genres?.map(genre => genre.trim()).filter(Boolean) || [])];
          if (genres.length) genres.forEach(genre => addToGroup(media, `genre:${genre}`, genre, genre));
          else addToGroup(media, 'genre:unknown', 'Unknown', null);
          break;
        }
        case 'language':
          addToGroup(media, `language:${media.language || 'unknown'}`, media.language || 'Unknown', media.language || null);
          break;
        case 'status':
          addToGroup(media, `status:${state?.current_status || 'unknown'}`, state?.current_status || 'Unknown', state?.current_status || null);
          break;
        case 'rating': {
          const score = scoreByMediaId[media.id];
          addToGroup(media, `rating:${score ?? 'unknown'}`, score === undefined ? 'Unrated' : `${score} / 5`, score ?? null);
          break;
        }
        case 'last_watched': {
          const watchedAt = state?.last_watched_played;
          const timestamp = parseDate(watchedAt);
          if (timestamp === null) {
            addToGroup(media, 'last-watched:unknown', 'Never watched', null);
          } else {
            const date = new Date(timestamp);
            const monthValue = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
            const monthLabel = new Intl.DateTimeFormat(undefined, {
              month: 'long',
              year: 'numeric',
              timeZone: 'UTC'
            }).format(date);
            addToGroup(media, `last-watched:${date.getUTCFullYear()}-${date.getUTCMonth()}`, monthLabel, monthValue);
          }
          break;
        }
        case 'completion_date': {
          const timestamp = parseDate(state?.most_recent_completion);
          if (timestamp === null) {
            addToGroup(media, 'completion-date:unknown', 'Not completed', null);
          } else {
            const date = new Date(timestamp);
            const monthValue = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
            const monthLabel = new Intl.DateTimeFormat(undefined, {
              month: 'long',
              year: 'numeric',
              timeZone: 'UTC'
            }).format(date);
            addToGroup(media, `completion-date:${date.getUTCFullYear()}-${date.getUTCMonth()}`, monthLabel, monthValue);
          }
          break;
        }
        case 'publisher':
          addToGroup(media, `publisher:${media.publisher || 'unknown'}`, media.publisher || 'Unknown', media.publisher || null);
          break;
        case 'developer':
          addToGroup(media, `developer:${media.developer || 'unknown'}`, media.developer || 'Unknown', media.developer || null);
          break;
      }
    });

    return Array.from(groups.entries())
      .sort(([, a], [, b]) => {
       const comparison = compareValues(a.value, b.value);
       return (gridPreferences.groupDescending ? -1 : 1) * comparison;
      })
      .map(([key, group]) => ({ key, label: group.label, items: group.items }));
  })();

  const cardOrientation = typeFilter ? orientationByType[typeFilter] || 'portrait' : 'portrait';
  const useLandscapeCards = isDesktop && cardOrientation === 'landscape';
  const renderGroupItems = (group: (typeof groupedItems)[number], horizontal = false) => {
    const cards = group.items.map(media => (
        <div
          key={`${group.key}:${media.id}`}
          className={horizontal
            ? `shrink-0 ${useLandscapeCards
              ? 'w-[calc(40%-12px)] sm:w-[calc(28%-12px)] md:w-[calc(30%-12px)] lg:w-[calc(25%-12px)] xl:w-[calc(22%-12px)]'
              : 'w-[calc(40%-12px)] sm:w-[calc(28%-12px)] md:w-[calc(15%-12px)]'
            }`
            : undefined
          }
        >
          <MediaCard
            media={media}
            state={stateByMediaId[media.id]}
            score={scoreByMediaId[media.id]}
            landscape={useLandscapeCards}
            landscapeImage={landscapeImageByMediaId[media.id]}
            onClick={onSelectMedia}
            onPreviewStart={onPreviewStart}
            onPreviewEnd={onPreviewEnd}
          />
        </div>
    ));

    return horizontal ? (
      <HorizontalDragScroll className="mt-2 flex gap-1 overflow-x-auto pb-4 pt-1 scrollbar-none">
        {cards}
      </HorizontalDragScroll>
    ) : (
      <div className="mt-2 grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1 sm:gap-4 md:gap-5">
        {cards}
      </div>
    );
  };

  const handleAddButtonClick = () => {
    if (onAddNewMedia) {
      onAddNewMedia();
    } else if (typeFilter) {
      setIsAddModalOpen(true);
    }
  };

  const resetFilters = () => {
    setSelectedGenre('All');
    setStatusFilter('All');
    setLanguageFilter('All');
    setTypeFilterValue('All');
    setYearFilter('All');
    setRatingFilter('All');
    setPublisherFilter('All');
    setDeveloperFilter('All');
    setRuntimeFilter('All');
    setWatchFilter('All');
    setCompletionFilter('All');
  };

  return (
    <div
      className="p-4 sm:p-6 md:p-8 pb-24 md:pb-8 space-y-4 mx-auto max-w-none transition-all duration-300"
      style={{
        paddingLeft: pagePadding,
        paddingTop: isDesktop?'': 'calc(env(safe-area-inset-top, 0px) + 12px)'
      }}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1f222e] pb-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">{title}</h1>
          <p className="text-xs sm:text-sm text-gray-400 font-medium mt-1">{subtitle}</p>
        </div>

        {(onAddNewMedia || typeFilter) && (
          <button
            onClick={() => {
              handleAddButtonClick();
              navigator.vibrate(15);
            }
            }
            className="flex items-center justify-center gap-2 rounded-lg border border-[#E27D12]/40 bg-[#E27D12] px-3.5 py-2 text-sm font-semibold text-white shadow-sm shadow-black/20 transition-colors hover:bg-[#f08a1b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E27D12] cursor-pointer touch-target w-full sm:w-auto"
          >
            <Plus className="h-4 w-4" />
            <span>Add Entry</span>
          </button>
        )}
      </div>

      <div className="sticky top-0 z-30 -mx-1 bg-[#101116]/95 px-1 py-2">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search your library by title or publisher..."
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              className="h-11 w-full rounded-lg border border-[#343744] bg-[#191a20] pl-11 pr-11 text-sm text-white placeholder:text-gray-500 focus:border-[#E27D12] focus:outline-none focus:ring-1 focus:ring-[#E27D12]/40"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div ref={filterPanelRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setIsAdvancedFiltersOpen(open => !open)}
              aria-expanded={isAdvancedFiltersOpen}
              aria-haspopup="dialog"
              className={`relative flex h-11 w-11 items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E27D12] sm:h-9 sm:w-auto sm:gap-2 sm:px-3 ${
                isAdvancedFiltersOpen || activeFilterCount > 0
                  ? 'border-[#E27D12]/50 bg-[#E27D12]/10 text-white'
                  : 'border-[#30323a] bg-[#191a20] text-gray-300 hover:border-[#555862] hover:text-white'
              }`}
              aria-label={`Open filters${activeFilterCount > 0 ? `, ${activeFilterCount} active` : ''}`}
            >
              <Filter className="h-4 w-4 text-[#E27D12]" />
              <span className="hidden text-xs font-medium sm:inline">Filters</span>
              {activeFilterCount > 0 && (
                <span className="absolute -right-1 -top-1 hidden h-4 min-w-4 items-center justify-center rounded-full bg-[#E27D12] px-1 text-[10px] font-bold leading-none text-white sm:static sm:flex">
                  {activeFilterCount}
                </span>
              )}
            </button>

            {isAdvancedFiltersOpen && (
              <>
                <button
                  type="button"
                  aria-label="Close filters"
                  onClick={() => setIsAdvancedFiltersOpen(false)}
                  className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm sm:hidden"
                />
                <div
                  role="dialog"
                  aria-label="Filters and organization"
                  className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-white/10 bg-[#161822]/95 p-5 pb-[calc(4.5rem+var(--sab,0px))] shadow-2xl shadow-black/50 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:bottom-auto sm:mt-2 sm:max-h-[min(70vh,34rem)] sm:w-[min(38rem,calc(100vw-2rem))] sm:rounded-lg sm:border sm:border-[#343744] sm:bg-[#191a20] sm:p-4"
                  style={{
                    backdropFilter: 'blur(40px) saturate(180%)',
                    WebkitBackdropFilter: 'blur(40px) saturate(180%)'
                  }}
                >
                <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-white/20 sm:hidden" />
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-white sm:hidden">Filters &amp; organize</h2>
                    <h2 className="hidden text-sm font-semibold text-white sm:block">Filters</h2>
                    <p className="mt-0.5 text-xs text-gray-500">Refine your library view.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsAdvancedFiltersOpen(false)}
                    aria-label="Close filters"
                    className="rounded-md p-1.5 text-gray-400 hover:bg-white/5 hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-xs text-gray-400">
                    <span className="block">Genre</span>
                    <select
                      aria-label="Filter by genre"
                      value={selectedGenre}
                      onChange={event => setSelectedGenre(event.target.value)}
                      className="w-full rounded-md border border-[#30323a] bg-[#111217] px-2.5 py-2 text-sm text-gray-200 focus:border-[#E27D12] focus:outline-none"
                    >
                      {availableGenres.map(genre => <option key={genre} value={genre}>{genre === 'All' ? 'All genres' : genre}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1 text-xs text-gray-400">
                    <span className="block">Status</span>
                    <select
                      aria-label="Filter by status"
                      value={statusFilter}
                      onChange={event => setStatusFilter(event.target.value)}
                      className="w-full rounded-md border border-[#30323a] bg-[#111217] px-2.5 py-2 text-sm text-gray-200 focus:border-[#E27D12] focus:outline-none"
                    >
                      <option value="All">All statuses</option>
                      <option value="Finished">Finished</option>
                      <option value="Watched Episode">Watched Episode</option>
                      <option value="Currently">Currently active</option>
                      <option value="Abandoned">Abandoned</option>
                      <option value="Paused">Paused</option>
                      <option value="Planned">Planned</option>
                    </select>
                  </label>
                  {availableLanguages.length > 1 && (
                    <label className="space-y-1 text-xs text-gray-400">
                      <span className="block">Language</span>
                      <select
                        aria-label="Filter by language"
                        value={languageFilter}
                        onChange={event => setLanguageFilter(event.target.value)}
                        className="w-full rounded-md border border-[#30323a] bg-[#111217] px-2.5 py-2 text-sm text-gray-200 focus:border-[#E27D12] focus:outline-none"
                      >
                        {availableLanguages.map(language => <option key={language} value={language}>{language === 'All' ? 'All languages' : language}</option>)}
                      </select>
                    </label>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {!typeFilter && (
                    <label className="space-y-1 text-xs text-gray-400">
                      <span className="block">Media type</span>
                      <select value={typeFilterValue} onChange={event => setTypeFilterValue(event.target.value)} className="w-full rounded-md border border-[#30323a] bg-[#111217] px-2.5 py-2 text-sm text-gray-200 focus:border-[#E27D12] focus:outline-none">
                        <option value="All">All media types</option>
                        <option value="Film">Film</option>
                        <option value="TV Series">TV series</option>
                        <option value="VideoGame">Video game</option>
                      </select>
                    </label>
                  )}
                  <label className="space-y-1 text-xs text-gray-400">
                    <span className="block">Release year</span>
                    <select value={yearFilter} onChange={event => setYearFilter(event.target.value)} className="w-full rounded-md border border-[#30323a] bg-[#111217] px-2.5 py-2 text-sm text-gray-200 focus:border-[#E27D12] focus:outline-none">
                      <option value="All">Any year</option>
                      {availableYears.map(year => <option key={year} value={year}>{year}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1 text-xs text-gray-400">
                    <span className="block">Rating</span>
                    <select value={ratingFilter} onChange={event => setRatingFilter(event.target.value)} className="w-full rounded-md border border-[#30323a] bg-[#111217] px-2.5 py-2 text-sm text-gray-200 focus:border-[#E27D12] focus:outline-none">
                      <option value="All">Any rating</option>
                      {availableRatings.map(rating => <option key={rating} value={rating}>{rating} / 5</option>)}
                      <option value="unrated">Unrated</option>
                    </select>
                  </label>
                  <label className="space-y-1 text-xs text-gray-400">
                    <span className="block">Publisher</span>
                    <select value={publisherFilter} onChange={event => setPublisherFilter(event.target.value)} className="w-full rounded-md border border-[#30323a] bg-[#111217] px-2.5 py-2 text-sm text-gray-200 focus:border-[#E27D12] focus:outline-none">
                      <option value="All">Any publisher</option>
                      {availablePublishers.map(publisher => <option key={publisher} value={publisher}>{publisher}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1 text-xs text-gray-400">
                    <span className="block">Developer</span>
                    <select value={developerFilter} onChange={event => setDeveloperFilter(event.target.value)} className="w-full rounded-md border border-[#30323a] bg-[#111217] px-2.5 py-2 text-sm text-gray-200 focus:border-[#E27D12] focus:outline-none">
                      <option value="All">Any developer</option>
                      {availableDevelopers.map(developer => <option key={developer} value={developer}>{developer}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1 text-xs text-gray-400">
                    <span className="block">Runtime</span>
                    <select value={runtimeFilter} onChange={event => setRuntimeFilter(event.target.value)} className="w-full rounded-md border border-[#30323a] bg-[#111217] px-2.5 py-2 text-sm text-gray-200 focus:border-[#E27D12] focus:outline-none">
                      <option value="All">Any runtime</option>
                      {availableRuntimes.map(runtime => <option key={runtime} value={runtime}>{runtime} min</option>)}
                    </select>
                  </label>
                  <label className="space-y-1 text-xs text-gray-400">
                    <span className="block">Watch history</span>
                    <select value={watchFilter} onChange={event => setWatchFilter(event.target.value)} className="w-full rounded-md border border-[#30323a] bg-[#111217] px-2.5 py-2 text-sm text-gray-200 focus:border-[#E27D12] focus:outline-none">
                      <option value="All">Any watch history</option>
                      <option value="watched">Previously watched</option>
                      <option value="unwatched">Never watched</option>
                    </select>
                  </label>
                  <label className="space-y-1 text-xs text-gray-400">
                    <span className="block">Completion</span>
                    <select value={completionFilter} onChange={event => setCompletionFilter(event.target.value)} className="w-full rounded-md border border-[#30323a] bg-[#111217] px-2.5 py-2 text-sm text-gray-200 focus:border-[#E27D12] focus:outline-none">
                      <option value="All">Any completion state</option>
                      <option value="completed">Completed</option>
                      <option value="incomplete">Not completed</option>
                    </select>
                  </label>
                </div>
                <div className="mt-4 flex justify-end border-t border-white/5 pt-3">
                  <button type="button" onClick={resetFilters} className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:bg-white/5 hover:text-white">
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset all filters
                  </button>
                </div>
                <div className="mt-2 border-t border-white/5 pt-3 sm:hidden">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">Organize</p>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1 text-xs text-gray-400">
                      <span className="block">Sort by</span>
                      <select
                        aria-label="Sort by"
                        value={gridPreferences.sortBy}
                        onChange={event => updateGridPreferences(current => ({ ...current, sortBy: event.target.value as MediaGridSortField }))}
                        className="w-full rounded-md border border-[#30323a] bg-[#111217] px-2.5 py-2 text-sm text-gray-200 focus:border-[#E27D12] focus:outline-none"
                      >
                        {SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1 text-xs text-gray-400">
                      <span className="block">Group by</span>
                      <select
                        aria-label="Group by"
                        value={gridPreferences.groupBy}
                        onChange={event => updateGridPreferences(current => ({ ...current, groupBy: event.target.value as MediaGridGroupField }))}
                        className="w-full rounded-md border border-[#30323a] bg-[#111217] px-2.5 py-2 text-sm text-gray-200 focus:border-[#E27D12] focus:outline-none"
                      >
                        {GROUP_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => updateGridPreferences(current => ({ ...current, sortDescending: !current.sortDescending }))}
                      aria-label={`Reverse sort order, currently ${gridPreferences.sortDescending ? 'descending' : 'ascending'}`}
                      className="flex flex-1 items-center justify-center gap-2 rounded-md border border-[#30323a] bg-[#111217] px-3 py-2 text-sm text-gray-200"
                    >
                      <ArrowDownUp className="h-4 w-4 text-[#E27D12]" />
                      {gridPreferences.sortDescending ? 'Descending' : 'Ascending'}
                    </button>
                    {gridPreferences.groupBy !== 'none' && (
                      <button
                        type="button"
                        onClick={() => updateGridPreferences(current => ({ ...current, groupDescending: !current.groupDescending }))}
                        aria-label={`Reverse group order, currently ${gridPreferences.groupDescending ? 'descending' : 'ascending'}`}
                        className="flex flex-1 items-center justify-center gap-2 rounded-md border border-[#30323a] bg-[#111217] px-3 py-2 text-sm text-gray-200"
                      >
                        <ArrowDownUp className="h-4 w-4 text-[#E27D12]" />
                        {gridPreferences.groupDescending ? 'Groups ↓' : 'Groups ↑'}
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsAdvancedFiltersOpen(false)}
                    className="mt-3 w-full rounded-md bg-[#E27D12] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#f08a1b]"
                  >
                    Done
                  </button>
                </div>
                </div>
              </>
            )}
          </div>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={resetFilters}
              title="Reset all filters"
              aria-label="Reset all filters"
              className="rounded-md p-2 text-gray-500 transition-colors hover:bg-white/5 hover:text-white"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="hidden flex-wrap items-center gap-2 border-t border-white/5 pt-2 sm:flex">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">Organize</span>
          <label className="flex min-w-[8rem] flex-1 items-center gap-2 text-xs text-gray-500 sm:flex-none">
            <span>Sort</span>
            <select
              aria-label="Sort by"
              value={gridPreferences.sortBy}
              onChange={event => updateGridPreferences(current => ({ ...current, sortBy: event.target.value as MediaGridSortField }))}
              className="min-w-0 flex-1 rounded-md border border-[#30323a] bg-[#191a20] px-2 py-1.5 text-xs text-gray-200 focus:border-[#E27D12] focus:outline-none sm:w-36 sm:flex-none"
            >
              {SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={() => updateGridPreferences(current => ({ ...current, sortDescending: !current.sortDescending }))}
            aria-label={`Reverse sort order, currently ${gridPreferences.sortDescending ? 'descending' : 'ascending'}`}
            title={`Sort ${gridPreferences.sortDescending ? 'descending' : 'ascending'}`}
            className="rounded-md border border-[#30323a] bg-[#191a20] p-1.5 text-gray-300 transition-colors hover:border-[#E27D12]/60 hover:text-white"
          >
            <ArrowDownUp className="h-3.5 w-3.5 text-[#E27D12]" />
          </button>
          <label className="flex min-w-[8rem] flex-1 items-center gap-2 text-xs text-gray-500 sm:flex-none">
            <span>Group</span>
            <select
              aria-label="Group by"
              value={gridPreferences.groupBy}
              onChange={event => updateGridPreferences(current => ({ ...current, groupBy: event.target.value as MediaGridGroupField }))}
              className="min-w-0 flex-1 rounded-md border border-[#30323a] bg-[#191a20] px-2 py-1.5 text-xs text-gray-200 focus:border-[#E27D12] focus:outline-none sm:w-36 sm:flex-none"
            >
              {GROUP_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          {gridPreferences.groupBy !== 'none' && (
            <button
              type="button"
              onClick={() => updateGridPreferences(current => ({ ...current, groupDescending: !current.groupDescending }))}
              aria-label={`Reverse group order, currently ${gridPreferences.groupDescending ? 'descending' : 'ascending'}`}
              title={`Groups ${gridPreferences.groupDescending ? 'descending' : 'ascending'}`}
              className="flex items-center gap-1.5 rounded-md border border-[#30323a] bg-[#191a20] px-2 py-1.5 text-xs text-gray-300 transition-colors hover:border-[#E27D12]/60 hover:text-white"
            >
              <ArrowDownUp className="h-3.5 w-3.5 text-[#E27D12]" />
              <span className="hidden sm:inline">{gridPreferences.groupDescending ? 'Groups ↓' : 'Groups ↑'}</span>
            </button>
          )}
        </div>
      </div>

      {preferenceError && (
        <p role="status" className="text-xs text-[#E27D12]">{preferenceError}</p>
      )}

      {/* Grid */}
      {sortedItems.length === 0 ? (
      <div className="p-8 sm:p-12 text-center text-gray-400 bg-[#14161f] rounded-xl border border-[#232736]">
        <p className="text-sm sm:text-base font-medium">No media found matching your filter criteria.</p>
      </div>
    ) : (
      <div
        className="space-y-7 will-change-transform"
        style={{
          transform: `translateY(${pullOffset}px)`,
          transition: pullOffset === 0 ? 'transform 300ms cubic-bezier(0.16, 1, 0.3, 1)' : 'none'
        }}
      >
      {groupedItems.map(group => group.label ? (
        <details key={group.key} className="group/details mb-6" open>
            <summary className="flex items-center justify-between cursor-pointer list-none mb-3 text-sm font-semibold text-gray-300 select-none hover:text-white transition-colors">
              <div className="flex items-center gap-2">
                <ChevronRight 
                  className="w-4 h-4 text-gray-500 transition-transform duration-200 group-open/details:rotate-90" 
                />
                <span>{group.label}</span>
                <span className="text-xs font-normal text-gray-500">{group.items.length}</span>
              </div>
            </summary>
          {renderGroupItems(group, true)}
        </details>
      ) : (
        <div key={group.key} className="mb-6">
          {renderGroupItems(group)}
        </div>
      ))}
      </div>
      )}

      {/* Add Media Modal */}
      {typeFilter && (
        <AddMediaModal
          type={typeFilter}
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          onMediaAdded={() => refreshList()}
          isCollapsed={isCollapsed}
        />
      )}
    </div>
  );
};
