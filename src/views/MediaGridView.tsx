import React, { useState, useEffect } from 'react';
import { MediaCard } from '../components/MediaCard';
import { AddMediaModal } from '../components/AddMediaModal';
import { Media, MediaType } from '../types/media';
import { dbService } from '../services/DatabaseService';
import { Search, Filter, Plus, X, RotateCcw } from 'lucide-react';
import { useSidebarPadding } from '../hooks/useSidebarPadding';

interface MediaGridViewProps {
  typeFilter?: MediaType;
  title: string;
  subtitle: string;
  onSelectMedia: (media: Media, clickedCardRect?: DOMRect) => void;
  onPreviewStart?: (media: Media, rect: DOMRect) => void;
  onPreviewEnd?: () => void;
  onAddNewMedia?: () => void;
  isCollapsed?: boolean;
}

export const MediaGridView: React.FC<MediaGridViewProps> = ({
  typeFilter,
  title,
  subtitle,
  onSelectMedia,
  onPreviewStart,
  onPreviewEnd,
  onAddNewMedia,
  isCollapsed
}) => {
  const { pagePadding } = useSidebarPadding(isCollapsed);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGenre, setSelectedGenre] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [languageFilter, setLanguageFilter] = useState<string>('All');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  const [mediaList, setMediaList] = useState<Media[]>([]);
  const [stateByMediaId, setStateByMediaId] = useState<Record<string, Awaited<ReturnType<typeof dbService.getMediaState>>>>({});
  const [scoreByMediaId, setScoreByMediaId] = useState<Record<string, number | undefined>>({});

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
    window.addEventListener('library-scanned', handleScanned);
    return () => {
      window.removeEventListener('library-scanned', handleScanned);
    };
  }, []);

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
        paddingLeft: pagePadding
      }}
    >
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#1f222e] pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">{title}</h1>
          <p className="text-xs sm:text-sm text-rose-400/80 font-medium mt-1">{subtitle}</p>
        </div>

        {(onAddNewMedia || typeFilter) && (
          <button
            onClick={handleAddButtonClick}
            className="flex items-center justify-center space-x-2 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm px-4 py-2.5 rounded-xl shadow-lg shadow-rose-950/30 transition-all cursor-pointer touch-target w-full sm:w-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Add Entry</span>
          </button>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div className="sticky top-0 z-30 flex items-center gap-3 bg-[#14161f]/95 backdrop-blur-xl p-3 sm:p-4 rounded-xl border border-[#232736] shadow-lg">
        {/* Search Box */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by title, publisher..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-[#1b1d2a] border border-[#2d3145] rounded-lg pl-10 pr-4 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-rose-500"
          />
        </div>

        {/* Mobile Filter Button (< 768px) */}
        <button
          onClick={() => setIsFilterSheetOpen(true)}
          className="md:hidden flex items-center space-x-2 bg-[#1b1d2a] hover:bg-[#252839] border border-[#2d3145] text-gray-200 px-3 py-2 rounded-lg text-sm font-medium touch-target cursor-pointer relative"
        >
          <Filter className="w-4 h-4 text-rose-400" />
          <span>Filters</span>
          {activeFilterCount > 0 && (
            <span className="bg-rose-500 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full">
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
              className="bg-[#1b1d2a] border border-[#2d3145] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-rose-500"
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
            className="bg-[#1b1d2a] border border-[#2d3145] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-rose-500"
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
              className="bg-[#1b1d2a] border border-[#2d3145] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-rose-500"
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

      {/* Grid */}
      {items.length === 0 ? (
        <div className="p-8 sm:p-12 text-center text-gray-400 bg-[#14161f] rounded-xl border border-[#232736]">
          <p className="text-sm sm:text-base font-medium">No media found matching your filter criteria.</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1 sm:gap-4 md:gap-5">
          {items.map(media => {
            return (
              <MediaCard
                key={media.id}
                media={media}
                state={stateByMediaId[media.id]}
                score={scoreByMediaId[media.id]}
                onClick={onSelectMedia}
                onPreviewStart={onPreviewStart}
                onPreviewEnd={onPreviewEnd}
              />
            );
          })}
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
                <Filter className="w-5 h-5 text-rose-500" />
                <h3 className="text-base font-bold text-white">Filter Library</h3>
                {activeFilterCount > 0 && (
                  <span className="bg-rose-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
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
              {/* Genre Filter */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-300 uppercase tracking-wider">Genre</label>
                <select
                  value={selectedGenre}
                  onChange={e => setSelectedGenre(e.target.value)}
                  className="w-full bg-[#1c1f2e] border border-[#2d3145] rounded-xl px-3.5 py-3 text-sm text-gray-100 focus:outline-none focus:border-rose-500"
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
                  className="w-full bg-[#1c1f2e] border border-[#2d3145] rounded-xl px-3.5 py-3 text-sm text-gray-100 focus:outline-none focus:border-rose-500"
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
                    className="w-full bg-[#1c1f2e] border border-[#2d3145] rounded-xl px-3.5 py-3 text-sm text-gray-100 focus:outline-none focus:border-rose-500"
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
                className="flex-1 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm py-3 px-4 rounded-xl shadow-lg transition-all cursor-pointer touch-target"
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
