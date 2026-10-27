import React, { useEffect, useState } from 'react';
import { Media } from '../types/media';
import { dbService } from '../services/DatabaseService';
import { History, Star, Film, Tv, Gamepad2, Bookmark } from 'lucide-react';
import { useSidebarPadding } from '../hooks/useSidebarPadding';

interface HistoryViewProps {
  onSelectMedia: (media: Media) => void;
  isCollapsed?: boolean;
}

export const HistoryView: React.FC<HistoryViewProps> = ({ onSelectMedia, isCollapsed }) => {
  const { pagePadding } = useSidebarPadding(isCollapsed);
  const [entries, setEntries] = useState<Array<{ history: Awaited<ReturnType<typeof dbService.getAllHistory>>[number]; media: Media }>>([]);

  useEffect(() => {
    let isMounted = true;
    const loadHistory = async () => {
      const allHistory = await dbService.getAllHistory();
      const entriesWithMedia = await Promise.all(allHistory.map(async history => ({
        history,
        media: await dbService.getMediaById(history.media_id)
      })));
      if (isMounted) {
        setEntries(entriesWithMedia.filter((entry): entry is { history: typeof allHistory[number]; media: Media } => Boolean(entry.media)));
      }
    };
    void loadHistory().catch(err => console.error('Failed to load history:', err));
    return () => { isMounted = false; };
  }, []);

  const getTypeIcon = (type?: string) => {
    switch (type) {
      case 'Film':
        return <Film className="w-3.5 h-3.5 text-rose-400" />;
      case 'TV Series':
        return <Tv className="w-3.5 h-3.5 text-sky-400" />;
      case 'VideoGame':
        return <Gamepad2 className="w-3.5 h-3.5 text-purple-400" />;
      default:
        return <Bookmark className="w-3.5 h-3.5 text-gray-400" />;
    }
  };

  return (
    <div
      className="p-4 sm:p-6 md:p-8 pb-24 md:pb-8 space-y-6 max-w-7xl mx-auto transition-all duration-300"
      style={{ paddingLeft: pagePadding }}
    >
      {/* Header Bar */}
      <div className="border-b border-[#1f222e] pb-6">
        <h1 className="text-3xl font-extrabold text-white tracking-tight flex items-center space-x-3">
          <History className="w-8 h-8 text-rose-500" />
          <span>Complete History Journal</span>
        </h1>
        <p className="text-sm text-rose-400/80 font-medium mt-1">
          Chronological timeline of all recorded watches, plays, rewatches, and restarts
        </p>
      </div>

      {/* History Journal List */}
      {entries.length === 0 ? (
        <div className="p-12 text-center text-gray-400 bg-[#14161f] rounded-xl border border-[#232736]">
          <p className="text-base font-medium">No history entries recorded in your journal yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {entries.map(({ history: h, media }) => {

            return (
              <div
                key={h.id}
                onClick={() => onSelectMedia(media)}
                className="group cursor-pointer bg-[#14161f] hover:bg-[#1a1d29] p-5 rounded-2xl border border-[#232736] hover:border-rose-500/50 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm"
              >
                <div className="flex items-center space-x-4">
                  {/* Poster Thumbnail */}
                  <div className="w-14 h-20 bg-[#1e212d] rounded-xl overflow-hidden shrink-0 border border-[#2d3145]">
                    {media.poster ? (
                      <img src={media.poster} alt={media.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        {getTypeIcon(media.type)}
                      </div>
                    )}
                  </div>

                  {/* Media Details */}
                  <div className="space-y-1.5">
                    <div className="flex items-center space-x-2">
                      <span className="bg-rose-950/80 text-rose-400 border border-rose-500/30 text-xs font-bold px-2 py-0.5 rounded flex items-center space-x-1">
                        {getTypeIcon(media.type)}
                        <span className="ml-1">{media.type}</span>
                      </span>

                      <span className="bg-[#1e212d] text-gray-300 text-xs font-semibold px-2 py-0.5 rounded">
                        Status: {h.status}
                      </span>

                      {h.context && (
                        <span className="bg-purple-950/80 text-purple-300 border border-purple-500/30 text-xs font-medium px-2 py-0.5 rounded">
                          {h.context}
                        </span>
                      )}
                    </div>

                    <h3 className="font-bold text-lg text-white group-hover:text-rose-400 transition-colors">
                      {media.title}
                    </h3>

                    {h.thoughts && (
                      <p className="text-xs text-gray-300 italic line-clamp-1">"{h.thoughts}"</p>
                    )}
                  </div>
                </div>

                {/* Score & Timestamps */}
                <div className="flex md:flex-col items-start md:items-end justify-between text-xs text-gray-400 shrink-0 gap-1 border-t md:border-t-0 border-[#1f222e] pt-2 md:pt-0">
                  {h.score && (
                    <span className="flex items-center space-x-1 text-amber-400 font-bold text-sm">
                      <Star className="w-4 h-4 fill-amber-400" />
                      <span>{h.score} / 5</span>
                    </span>
                  )}
                  <span className="font-mono text-[11px] text-gray-400">
                    Logged: {h.completed_at || h.started_at || h.created_at.split('T')[0]}
                  </span>
                  <span className="text-[10px] text-gray-500">Source: {h.source}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
