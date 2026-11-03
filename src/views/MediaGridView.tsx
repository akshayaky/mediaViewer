import React, { useState, useEffect, useRef } from 'react';
import { MediaCard } from '../components/MediaCard';
import { AddMediaModal } from '../components/AddMediaModal';
import { Media, MediaGridGroupField, MediaGridPreferences, MediaGridSortField, MediaType } from '../types/media';
import { dbService } from '../services/DatabaseService';
import { ArrowDownUp, Search, Filter, Plus, X, RotateCcw, ChevronRight} from 'lucide-react';
import { useSidebarPadding } from '../hooks/useSidebarPadding';

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
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  const [mediaList, setMediaList] = useState<Media[]>([]);
  const [stateByMediaId, setStateByMediaId] = useState<Record<string, Awaited<ReturnType<typeof dbService.getMediaState>>>>({});
  const [scoreByMediaId, setScoreByMediaId] = useState<Record<string, number | undefined>>({});
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
  };
  

  useEffect(() => {
    const handleScanned = () => { void refreshList(); };
    void refreshList();
    void dbService.getSettings().then(settings => {
      const saved = settings.media_grid_preferences;
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
      setPreferenceError('Could not load sorting and grouping preferences.');
      console.error('Failed to load media grid preferences:', error);
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

  // Listen for custom close-mobile-sheets event
  useEffect(() => {
    if (isFilterSheetOpen) {
      window.history.pushState({ isSheetOpen: true }, '');
    }
  }, [isFilterSheetOpen]);

  useEffect(() => {
    const handleCloseSheets = (e: CustomEvent) => {
      if (isFilterSheetOpen) {
        setIsFilterSheetOpen(false);
        e.preventDefault();
      }
    };
    window.addEventListener('close-mobile-sheets' as any, handleCloseSheets);
    return () => {
      window.removeEventListener('close-mobile-sheets' as any, handleCloseSheets);
    };
  }, [isFilterSheetOpen]);

  // Catch over-swipe/pull down at the top of the viewport to focus search
useEffect(() => {
  if (isDetailsOpen || isAddModalOpen || isFilterSheetOpen) return;
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
}, [isDetailsOpen, isAddModalOpen, isFilterSheetOpen]);



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

  // Active filter count
  const activeFilterCount = (selectedGenre !== 'All' ? 1 : 0) +
    (statusFilter !== 'All' ? 1 : 0) +
    (languageFilter !== 'All' ? 1 : 0);

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
  };

  return (
    <div
      className="p-4 sm:p-6 md:p-8 pb-24 md:pb-8 space-y-6 mx-auto max-w-none transition-all duration-300"
      style={{
        paddingLeft: pagePadding,
        paddingTop: isDesktop?'': 'calc(env(safe-area-inset-top, 0px) + 12px)'
      }}
    >
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#1f222e] pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">{title}</h1>
          <p className="text-xs sm:text-sm text-[#E27D12]/80 font-medium mt-1">{subtitle}</p>
        </div>

        {(onAddNewMedia || typeFilter) && (
          <button
            onClick={() => {
              handleAddButtonClick();
              navigator.vibrate(15);
            }

            }
            className="flex items-center justify-center space-x-2 bg-[#E27D12] hover:bg-[#E27D12] text-white font-semibold text-sm px-4 py-2.5 rounded-xl shadow-lg shadow-rose-950/30 transition-all cursor-pointer touch-target w-full sm:w-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Add Entry</span>
          </button>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div style={{ top: 'calc(env(safe-area-inset-top, 0px))' }} 
      className="sticky top-0 z-30 flex items-center gap-3 bg-[#14161f]/95 backdrop-blur-xl p-3 sm:p-4 rounded-xl border border-[#232736] shadow-lg">
        {/* Search Box */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search by title, publisher..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-[#1b1d2a] border border-[#2d3145] rounded-lg pl-10 pr-4 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-[#E27D12]"
          />
        </div>

        {/* Mobile Filter Button (< 768px) */}
        <button
          onClick={() => setIsFilterSheetOpen(true)}
          className="md:hidden flex items-center space-x-2 bg-[#1b1d2a] hover:bg-[#252839] border border-[#2d3145] text-gray-200 px-3 py-2 rounded-lg text-sm font-medium touch-target cursor-pointer relative"
        >
          <Filter className="w-4 h-4 text-[#E27D12]" />
          <span>Sort &amp; filters</span>
          {activeFilterCount > 0 && (
            <span className="bg-[#E27D12] text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full">
              {activeFilterCount}
            </span>
          )}
        </button>

        {/* Desktop Filter Toolbar (>= 768px) */}
        <div className="hidden md:flex items-center gap-3">
          {/* Genre Filter */}
          <div className="flex items-center space-x-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              value={selectedGenre}
              onChange={e => setSelectedGenre(e.target.value)}
              className="bg-[#1b1d2a] border border-[#2d3145] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-[#E27D12]"
            >
              {availableGenres.map(g => (
                <option key={g} value={g}>
                  Genre: {g}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-[#1b1d2a] border border-[#2d3145] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-[#E27D12]"
          >
            <option value="All">Status: All</option>
            <option value="Finished">Status: Finished</option>
            <option value="Currently">Status: Currently Active</option>
            <option value="Abandoned">Status: Paused / Abandoned</option>
            <option value="Planned">Status: Planned</option>
          </select>

          {/* Language Filter */}
          {availableLanguages.length > 1 && (
            <select
              value={languageFilter}
              onChange={e => setLanguageFilter(e.target.value)}
              className="bg-[#1b1d2a] border border-[#2d3145] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-[#E27D12]"
            >
              {availableLanguages.map(g => (
                <option key={g} value={g}>
                  Language: {g}
                </option>
              ))}
            </select>
          )}

          {activeFilterCount > 0 && (
            <button
              onClick={resetFilters}
              className="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg text-xs flex items-center space-x-1 cursor-pointer"
              title="Reset Filters"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {preferenceError && (
        <p role="status" className="text-xs text-[#E27D12]">{preferenceError}</p>
      )}

      <div className="hidden md:flex flex-wrap items-center gap-3 rounded-xl border border-[#232736] bg-[#14161f]/80 p-3">
        <label className="flex items-center gap-2 text-xs font-medium text-gray-400">
          Sort by
          <select
            value={gridPreferences.sortBy}
            onChange={event => updateGridPreferences(current => ({ ...current, sortBy: event.target.value as MediaGridSortField }))}
            className="bg-[#1b1d2a] border border-[#2d3145] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-[#E27D12]"
          >
            {SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <button
          type="button"
          onClick={() => updateGridPreferences(current => ({ ...current, sortDescending: !current.sortDescending }))}
          aria-label={`Reverse sort order, currently ${gridPreferences.sortDescending ? 'descending' : 'ascending'}`}
          title={`Reverse sort order (${gridPreferences.sortDescending ? 'descending' : 'ascending'})`}
          className="flex items-center gap-2 rounded-lg border border-[#2d3145] bg-[#1b1d2a] px-3 py-2 text-sm text-gray-200 hover:border-[#E27D12]"
        >
          <ArrowDownUp className="h-4 w-4 text-[#E27D12]" />
          {gridPreferences.sortDescending ? 'Descending' : 'Ascending'}
        </button>
        <label className="flex items-center gap-2 text-xs font-medium text-gray-400">
          Group by
          <select
            value={gridPreferences.groupBy}
            onChange={event => updateGridPreferences(current => ({ ...current, groupBy: event.target.value as MediaGridGroupField }))}
            className="bg-[#1b1d2a] border border-[#2d3145] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-[#E27D12]"
          >
            {GROUP_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>

        {gridPreferences.groupBy !== 'none' && (
        <button
          type="button"
          onClick={() => updateGridPreferences(current => ({ ...current, groupDescending: !current.groupDescending }))}
          className="flex items-center gap-2 rounded-lg border border-[#2d3145] bg-[#1b1d2a] px-3 py-2 text-sm text-gray-200 hover:border-[#E27D12]"
        >
          <ArrowDownUp className="h-4 w-4 text-[#E27D12]" />
          Groups: {gridPreferences.groupDescending ? 'Descending' : 'Ascending'}
        </button>
        )}
      </div>

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
      {groupedItems.map(group => (
        <details key={group.key} className="group/details mb-6" open>
          {group.label && (
            <summary className="flex items-center justify-between cursor-pointer list-none mb-3 text-sm font-semibold text-gray-300 select-none hover:text-white transition-colors">
              <div className="flex items-center gap-2">
                <ChevronRight 
                  className="w-4 h-4 text-gray-500 transition-transform duration-200 group-open/details:rotate-90" 
                />
                <span>{group.label}</span>
                <span className="text-xs font-normal text-gray-500">{group.items.length}</span>
              </div>
            </summary>
          )}
          
          <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1 sm:gap-4 md:gap-5 mt-2">
            {group.items.map(media => (
              <MediaCard
                key={`${group.key}:${media.id}`}
                media={media}
                state={stateByMediaId[media.id]}
                score={scoreByMediaId[media.id]}
                onClick={onSelectMedia}
                onPreviewStart={onPreviewStart}
                onPreviewEnd={onPreviewEnd}
              />
            ))}
          </div>
        </details>
      ))}
      </div>
      )}

      {/* Mobile Filter Slide-up Bottom Sheet */}
      {isFilterSheetOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-sm transition-opacity"
            onClick={() => setIsFilterSheetOpen(false)}
          />

          {/* Sheet Drawer */}
          <div className="relative z-50 bg-[#161822] border-t border-white/10 rounded-t-2xl p-5 shadow-2xl space-y-5 animate-in slide-in-from-bottom duration-250"
            style={{ paddingBottom: 'calc(4.5rem + var(--sab, 0px))' }}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center space-x-2">
                <Filter className="w-5 h-5 text-[#E27D12]" />
                <h3 className="text-base font-bold text-white">Library View</h3>
                {activeFilterCount > 0 && (
                  <span className="bg-[#E27D12] text-white text-xs font-bold px-2 py-0.5 rounded-full">
                    {activeFilterCount} active
                  </span>
                )}
              </div>
              <button
                onClick={() => setIsFilterSheetOpen(false)}
                className="p-1.5 rounded-full bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-300 uppercase tracking-wider">Sort by</label>
                  <select
                    value={gridPreferences.sortBy}
                    onChange={event => updateGridPreferences(current => ({ ...current, sortBy: event.target.value as MediaGridSortField }))}
                    className="w-full bg-[#1c1f2e] border border-[#2d3145] rounded-xl px-3 py-3 text-sm text-gray-100 focus:outline-none focus:border-[#E27D12]"
                  >
                    {SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-300 uppercase tracking-wider">Group by</label>
                  <select
                    value={gridPreferences.groupBy}
                    onChange={event => updateGridPreferences(current => ({ ...current, groupBy: event.target.value as MediaGridGroupField }))}
                    className="w-full bg-[#1c1f2e] border border-[#2d3145] rounded-xl px-3 py-3 text-sm text-gray-100 focus:outline-none focus:border-[#E27D12]"
                  >
                    {GROUP_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
              </div>
              <button
                type="button"
                onClick={() => updateGridPreferences(current => ({ ...current, sortDescending: !current.sortDescending }))}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#2d3145] bg-[#1c1f2e] px-3 py-3 text-sm text-gray-200"
              >
                <ArrowDownUp className="h-4 w-4 text-[#E27D12]" />
                {gridPreferences.sortDescending ? 'Descending order' : 'Ascending order'}
              </button>

              {/* NEW: Mobile Group Order Toggle */}
              {gridPreferences.groupBy !== 'none' && (
                <button
                  type="button"
                  onClick={() => updateGridPreferences(current => ({ ...current, groupDescending: !current.groupDescending }))}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#2d3145] bg-[#1c1f2e] px-3 py-3 text-sm text-gray-200 mt-2"
                >
                  <ArrowDownUp className="h-4 w-4 text-[#E27D12]" />
                  {gridPreferences.groupDescending ? 'Groups: Descending' : 'Groups: Ascending'}
                </button>
              )}

              {/* Genre Filter */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-300 uppercase tracking-wider">Genre</label>
                <select
                  value={selectedGenre}
                  onChange={e => setSelectedGenre(e.target.value)}
                  className="w-full bg-[#1c1f2e] border border-[#2d3145] rounded-xl px-3.5 py-3 text-sm text-gray-100 focus:outline-none focus:border-[#E27D12]"
                >
                  {availableGenres.map(g => (
                    <option key={g} value={g}>
                      Genre: {g}
                    </option>
                  ))}
                </select>
              </div>

              {/* Status Filter */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-300 uppercase tracking-wider">Status</label>
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                  className="w-full bg-[#1c1f2e] border border-[#2d3145] rounded-xl px-3.5 py-3 text-sm text-gray-100 focus:outline-none focus:border-[#E27D12]"
                >
                  <option value="All">Status: All</option>
                  <option value="Finished">Status: Finished</option>
                  <option value="Currently">Status: Currently Active</option>
                  <option value="Abandoned">Status: Paused / Abandoned</option>
                  <option value="Planned">Status: Planned</option>
                </select>
              </div>

              {/* Language Filter */}
              {availableLanguages.length > 1 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-300 uppercase tracking-wider">Language</label>
                  <select
                    value={languageFilter}
                    onChange={e => setLanguageFilter(e.target.value)}
                    className="w-full bg-[#1c1f2e] border border-[#2d3145] rounded-xl px-3.5 py-3 text-sm text-gray-100 focus:outline-none focus:border-[#E27D12]"
                  >
                    {availableLanguages.map(g => (
                      <option key={g} value={g}>
                        Language: {g}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center space-x-3 pt-2">
              <button
                onClick={resetFilters}
                className="flex-1 bg-[#232738] hover:bg-[#2c3147] text-gray-300 font-semibold text-sm py-3 px-4 rounded-xl transition-all cursor-pointer touch-target flex items-center justify-center space-x-2"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Reset</span>
              </button>
              <button
                onClick={() => setIsFilterSheetOpen(false)}
                className="flex-1 bg-[#E27D12] hover:bg-[#E27D12] text-white font-semibold text-sm py-3 px-4 rounded-xl shadow-lg transition-all cursor-pointer touch-target"
              >
                Apply Filters
              </button>
            </div>
          </div>
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
