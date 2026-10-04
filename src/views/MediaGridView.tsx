import React, { useState } from 'react';
import { MediaCard } from '../components/MediaCard';
import { Media, MediaType } from '../types/media';
import { dbService } from '../services/DatabaseService';
import { Search, Filter, Plus } from 'lucide-react';

interface MediaGridViewProps {
  typeFilter?: MediaType;
  title: string;
  subtitle: string;
  onSelectMedia: (media: Media) => void;
  onAddNewMedia?: () => void;
}

export const MediaGridView: React.FC<MediaGridViewProps> = ({
  typeFilter,
  title,
  subtitle,
  onSelectMedia,
  onAddNewMedia
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGenre, setSelectedGenre] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');

  const allMedia = dbService.getAllMedia();

  // Filter by media type if specified
  let items = typeFilter ? allMedia.filter(m => m.type === typeFilter) : allMedia;

  // Extract unique genres
  const genresSet = new Set<string>();
  items.forEach(m => m.genres?.forEach(g => genresSet.add(g)));
  const availableGenres = ['All', ...Array.from(genresSet)];

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
      const state = dbService.getMediaState(m.id);
      return state.current_status === statusFilter;
    });
  }

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1f222e] pb-6">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">{title}</h1>
          <p className="text-sm text-rose-400/80 font-medium mt-1">{subtitle}</p>
        </div>

        {onAddNewMedia && (
          <button
            onClick={onAddNewMedia}
            className="flex items-center space-x-2 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm px-4 py-2.5 rounded-xl shadow-lg shadow-rose-950/30 transition-all self-start md:self-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Add Entry</span>
          </button>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center gap-4 bg-[#14161f] p-4 rounded-xl border border-[#232736]">
        {/* Search Box */}
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by title, publisher..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-[#1b1d2a] border border-[#2d3145] rounded-lg pl-10 pr-4 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-rose-500"
          />
        </div>

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
      </div>

      {/* Grid */}
      {items.length === 0 ? (
        <div className="p-12 text-center text-gray-400 bg-[#14161f] rounded-xl border border-[#232736]">
          <p className="text-base font-medium">No media found matching your filter criteria.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
          {items.map(media => {
            const state = dbService.getMediaState(media.id);
            const history = dbService.getHistoryForMedia(media.id);
            const score = history[0]?.score;

            return (
              <MediaCard
                key={media.id}
                media={media}
                state={state}
                score={score}
                onClick={onSelectMedia}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};
