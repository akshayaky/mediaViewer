// import React, { useState } from 'react';
// import { Media } from '../types/media';
// import { MetadataSearchResult } from '../providers/interfaces';
// import { tmdbProvider } from '../providers/TMDBProvider';
// import { igdbProvider } from '../providers/IGDBProvider';
// import { artworkCacheProvider } from '../providers/ArtworkCacheProvider';
// import { Search, Loader2, X, Image as ImageIcon, CheckCircle2 } from 'lucide-react';

// interface ChangeBackgroundModalProps {
//   media: Media;
//   isOpen: boolean;
//   onClose: () => void;
//   onBackgroundUpdated: (updatedMedia: Media) => void;
// }

// export const ChangeBackgroundModal: React.FC<ChangeBackgroundModalProps> = ({
//   media,
//   isOpen,
//   onClose,
//   onBackgroundUpdated
// }) => {
//   const [query, setQuery] = useState(media.title);
//   const [results, setResults] = useState<MetadataSearchResult[]>([]);
//   const [isSearching, setIsSearching] = useState(false);
//   const [selectedResult, setSelectedResult] = useState<MetadataSearchResult | null>(null);
//   const [isSaving, setIsSaving] = useState(false);

//   if (!isOpen) return null;

//   const handleSearch = async (e?: React.FormEvent) => {
//     if (e) e.preventDefault();
//     if (!query.trim()) return;

//     setIsSearching(true);
//     setResults([]);
//     setSelectedResult(null);

//     try {
//       let searchResults: MetadataSearchResult[] = [];
//       if (media.type === 'VideoGame') {
//         searchResults = await igdbProvider.searchMedia(query, 'VideoGame');
//       } else {
//         searchResults = await tmdbProvider.searchMedia(query, media.type);
//       }
//       setResults(searchResults);
//     } catch (err) {
//       console.error('Failed to search for background image:', err);
//     } finally {
//       setIsSearching(false);
//     }
//   };

//   const handleConfirmChange = async () => {
//     if (!selectedResult || !selectedResult.backdrop) return;

//     setIsSaving(true);
//     try {
//       const now = new Date().toISOString();
//       const updatedMedia: Media = {
//         ...media,
//         backdrop: selectedResult.backdrop,
//         updated_at: now,
//       };

//       // Update the cache so the Detail View picks up the change immediately
//       artworkCacheProvider.setCachedArtwork(
//         media.id,
//         { backdrop: selectedResult.backdrop }
//       );

//       onBackgroundUpdated(updatedMedia);
//       onClose();
//     } catch (err) {
//       console.error('Failed to update background image:', err);
//     } finally {
//       setIsSaving(false);
//     }
//   };

//   return (
//     <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
//       <div className="bg-[#14161f] border border-[#2d3145] rounded-2xl w-full max-w-2xl flex flex-col max-h-[85vh] shadow-2xl overflow-hidden animate-fadeIn">
//         <div className="p-5 border-b border-[#232736] flex items-center justify-between">
//           <div className="flex items-center space-x-3">
//             <ImageIcon className="w-5 h-5 text-sky-400" />
//             <div>
//               <h2 className="text-lg font-bold text-white">Change Background Image</h2>
//               <p className="text-xs text-gray-400">Search for a title to use its backdrop as your background</p>
//             </div>
//           </div>
//           <button onClick={onClose} className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-[#1f222e] transition-colors cursor-pointer">
//             <X className="w-5 h-5" />
//           </button>
//         </div>

//         <div className="p-6 space-y-4 flex-1 overflow-y-auto">
//           <form onSubmit={handleSearch} className="flex space-x-2">
//             <div className="relative flex-1">
//               <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
//               <input
//                 type="text"
//                 placeholder="Search for movie, show or game..."
//                 value={query}
//                 onChange={e => setQuery(e.target.value)}
//                 className="w-full bg-[#1b1d2a] border border-[#2d3145] rounded-xl pl-10 pr-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-sky-500"
//               />
//             </div>
//             <button
//               type="submit"
//               disabled={isSearching || !query.trim()}
//               className="bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold text-xs px-5 py-2.5 rounded-xl transition-all flex items-center space-x-2 cursor-pointer shrink-0"
//             >
//               {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
//               <span>Search</span>
//             </button>
//           </form>

//           {results.length > 0 && (
//             <div className="space-y-2">
//               <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Search Results</h4>
//               <div className="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto pr-1">
//                 {results.map((res, idx) => (
//                   <div
//                     key={`${res.external_id}_${idx}`}
//                     onClick={() => setSelectedResult(res)}
//                     className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
//                       selectedResult?.external_id === res.external_id
//                         ? 'bg-sky-950/40 border-sky-500'
//                         : 'bg-[#1b1d2a] border-[#2d3145] hover:border-gray-500'
//                     }`}
//                   >
//                     <div className="flex items-center space-x-3 min-w-0">
//                       {res.backdrop ? (
//                         <img src={res.backdrop} alt="" className="w-20 h-10 object-cover rounded border border-[#2d3145] shrink-0" />
//                       ) : (
//                         <div className="w-20 h-10 bg-[#232736] rounded shrink-0 flex items-center justify-center">
//                           <ImageIcon className="w-4 h-4 text-gray-500" />
//                         </div>
//                       )}
//                       <div className="min-w-0">
//                         <h5 className="font-bold text-xs text-white truncate">{res.title}</h5>
//                         <p className="text-[11px] text-gray-400">{res.release_year} • {res.provider}</p>
//                       </div>
//                     </div>
//                     <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
//                       selectedResult?.external_id === res.external_id ? 'bg-sky-500 border-sky-400 text-white' : 'border-gray-500'
//                     }`}>
//                       {selectedResult?.external_id === res.external_id && <CheckCircle2 className="w-3.5 h-3.5" />}
//                     </div>
//                   </div>
//                 ))}
//               </div>
//             </div>
//           )}

//           {selectedResult && (
//             <div className="bg-[#1b1d2a] border border-[#2d3145] p-4 rounded-xl space-y-3">
//               <h4 className="text-xs font-bold text-sky-400 uppercase tracking-wider">Preview Backdrop</h4>
//               {selectedResult.backdrop ? (
//                 <img src={selectedResult.backdrop} alt="Preview" className="w-full h-32 object-cover rounded-lg border border-[#2d3145] shadow-lg" />
//               ) : (
//                 <div className="w-full h-32 bg-[#232736] rounded-lg flex items-center justify-center text-gray-500 text-xs">
//                   No backdrop available for this selection.
//                 </div>
//               )}
//             </div>
//           )}
//         </div>

//         <div className="p-4 border-t border-[#232736] flex items-center justify-end space-x-3 bg-[#11131c]">
//           <button onClick={onClose} className="px-4 py-2 rounded-xl border border-[#2d3145] text-gray-300 hover:bg-[#1a1c29] text-xs font-semibold transition-colors cursor-pointer">
//             Cancel
//           </button>
//           <button
//             onClick={handleConfirmChange}
//             disabled={!selectedResult || !selectedResult.backdrop || isSaving}
//             className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-md cursor-pointer flex items-center space-x-1.5"
//           >
//             {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
//             <span>Apply Background</span>
//           </button>
//         </div>
//       </div>
//     </div>
//   );
// };
