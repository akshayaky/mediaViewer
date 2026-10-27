import React, { useEffect, useState } from 'react';
import { Wishlist, MediaType } from '../types/media';
import { dbService } from '../services/DatabaseService';
import { Heart, Plus, ExternalLink, Calendar, Tag } from 'lucide-react';
import { useSidebarPadding } from '../hooks/useSidebarPadding';

interface WishlistViewProps {
  isCollapsed?: boolean;
}

export const WishlistView: React.FC<WishlistViewProps> = ({ isCollapsed }) => {
  const { pagePadding } = useSidebarPadding(isCollapsed);
  const [wishlistItems, setWishlistItems] = useState<Wishlist[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<MediaType>('Film');
  const [source, setSource] = useState('Manual');
  const [notes, setNotes] = useState('');
  const [poster, setPoster] = useState('');

  useEffect(() => {
    void dbService.getAllWishlist().then(setWishlistItems)
      .catch(err => console.error('Failed to load wishlist:', err));
  }, []);

  const handleAddWishlist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const newItem: Wishlist = {
      id: `wish_${Date.now()}`,
      title: title.trim(),
      type,
      source,
      notes: notes.trim() || undefined,
      poster: poster.trim() || undefined,
      added_at: new Date().toISOString()
    };

    await dbService.saveWishlist(newItem);
    setWishlistItems(await dbService.getAllWishlist());
    setShowAddModal(false);
    setTitle('');
    setNotes('');
    setPoster('');
  };

  return (
    <div
      className="p-4 sm:p-6 md:p-8 pb-24 md:pb-8 space-y-6 max-w-7xl mx-auto transition-all duration-300"
      style={{ paddingLeft: pagePadding }}
    >
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1f222e] pb-6">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight flex items-center space-x-3">
            <Heart className="w-8 h-8 text-rose-500 fill-rose-500/20" />
            <span>Wishlist & Wanted</span>
          </h1>
          <p className="text-sm text-rose-400/80 font-medium mt-1">
            Media items flagged from Google, Notion, or manual additions
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center space-x-2 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm px-4 py-2.5 rounded-xl shadow-lg shadow-rose-950/30 transition-all self-start md:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Add Wishlist Item</span>
        </button>
      </div>

      {/* Grid of Wishlist items */}
      {wishlistItems.length === 0 ? (
        <div className="p-12 text-center text-gray-400 bg-[#14161f] rounded-xl border border-[#232736]">
          <p className="text-base font-medium">Your wishlist is currently empty.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {wishlistItems.map(item => (
            <div
              key={item.id}
              className="bg-[#14161f] rounded-2xl overflow-hidden border border-[#232736] hover:border-rose-500/50 transition-all flex flex-col justify-between"
            >
              {/* Optional Poster Header */}
              {item.poster && (
                <div className="h-40 w-full overflow-hidden bg-[#1b1d2a]">
                  <img src={item.poster} alt={item.title} className="w-full h-full object-cover" />
                </div>
              )}

              <div className="p-5 space-y-3 flex-1 flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="bg-rose-950/80 text-rose-400 border border-rose-500/30 font-bold px-2 py-0.5 rounded">
                      {item.type}
                    </span>
                    <span className="bg-[#1e212d] text-gray-400 px-2 py-0.5 rounded font-medium text-[11px] flex items-center space-x-1">
                      <Tag className="w-3 h-3" />
                      <span>{item.source}</span>
                    </span>
                  </div>

                  <h3 className="font-bold text-base text-white">{item.title}</h3>

                  {item.notes && <p className="text-xs text-gray-300 leading-relaxed line-clamp-2">{item.notes}</p>}
                </div>

                <div className="pt-3 border-t border-[#1f222e] flex items-center justify-between text-[11px] text-gray-400">
                  <span className="flex items-center space-x-1">
                    <Calendar className="w-3 h-3 text-rose-500" />
                    <span>Added {item.added_at.split('T')[0]}</span>
                  </span>
                  {item.external_url && (
                    <a
                      href={item.external_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-rose-400 hover:underline flex items-center space-x-1"
                    >
                      <span>Link</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#14161f] border border-[#2d3145] rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-white">Add Wishlist Item</h3>
            <form onSubmit={handleAddWishlist} className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 font-medium block mb-1">Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Dune Part Two"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full bg-[#1b1d2a] border border-[#2d3145] rounded-lg p-2 text-sm text-gray-100"
                />
              </div>

              <div>
                <label className="text-xs text-gray-400 font-medium block mb-1">Type</label>
                <select
                  value={type}
                  onChange={e => setType(e.target.value as MediaType)}
                  className="w-full bg-[#1b1d2a] border border-[#2d3145] rounded-lg p-2 text-sm text-gray-100"
                >
                  <option value="Film">Film</option>
                  <option value="TV Series">TV Series</option>
                  <option value="VideoGame">Video Game</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-gray-400 font-medium block mb-1">Source</label>
                <input
                  type="text"
                  placeholder="e.g. Google, Notion, Friend Recommendation"
                  value={source}
                  onChange={e => setSource(e.target.value)}
                  className="w-full bg-[#1b1d2a] border border-[#2d3145] rounded-lg p-2 text-sm text-gray-100"
                />
              </div>

              <div>
                <label className="text-xs text-gray-400 font-medium block mb-1">Poster Image URL (Optional)</label>
                <input
                  type="url"
                  placeholder="https://..."
                  value={poster}
                  onChange={e => setPoster(e.target.value)}
                  className="w-full bg-[#1b1d2a] border border-[#2d3145] rounded-lg p-2 text-sm text-gray-100"
                />
              </div>

              <div>
                <label className="text-xs text-gray-400 font-medium block mb-1">Notes</label>
                <textarea
                  rows={2}
                  placeholder="Why do you want to watch/play this?"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="w-full bg-[#1b1d2a] border border-[#2d3145] rounded-lg p-2 text-sm text-gray-100"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-gray-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white rounded-lg shadow-md"
                >
                  Save Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
