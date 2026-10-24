import React, { useEffect, useState } from 'react';
import { Media } from '../types/media';
import { dbService } from '../services/DatabaseService';
import { AlertTriangle, Check, X, Film, Tv, Gamepad2, FileText, History, HardDrive } from 'lucide-react';

interface MergeDuplicateModalProps {
  mediaA: Media;
  mediaB: Media;
  isOpen: boolean;
  onClose: () => void;
  onMerged: (survivingMedia: Media) => void;
}

export const MergeDuplicateModal: React.FC<MergeDuplicateModalProps> = ({
  mediaA,
  mediaB,
  isOpen,
  onClose,
  onMerged
}) => {
  const [selectedSurvivingId, setSelectedSurvivingId] = useState<string>(mediaA.id);
  const [editableTitle, setEditableTitle] = useState<string>(mediaA.title);
  const [editableYear, setEditableYear] = useState<string>(mediaA.release_year ? String(mediaA.release_year) : '');
  const [editableDescription, setEditableDescription] = useState<string>(mediaA.description || '');
  const [filesA, setFilesA] = useState<Awaited<ReturnType<typeof dbService.getLocalFilesForMedia>>>([]);
  const [filesB, setFilesB] = useState<Awaited<ReturnType<typeof dbService.getLocalFilesForMedia>>>([]);
  const [historyA, setHistoryA] = useState<Awaited<ReturnType<typeof dbService.getHistoryForMedia>>>([]);
  const [historyB, setHistoryB] = useState<Awaited<ReturnType<typeof dbService.getHistoryForMedia>>>([]);

  useEffect(() => {
    if (isOpen) {
      window.history.pushState({ isModalOpen: true }, '');
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleCloseSheets = (e: CustomEvent) => {
      onClose();
      e.preventDefault();
    };
    window.addEventListener('close-mobile-sheets' as any, handleCloseSheets);
    return () => {
      window.removeEventListener('close-mobile-sheets' as any, handleCloseSheets);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;
    Promise.all([
      dbService.getLocalFilesForMedia(mediaA.id),
      dbService.getLocalFilesForMedia(mediaB.id),
      dbService.getHistoryForMedia(mediaA.id),
      dbService.getHistoryForMedia(mediaB.id)
    ]).then(([nextFilesA, nextFilesB, nextHistoryA, nextHistoryB]) => {
      if (!isMounted) return;
      setFilesA(nextFilesA);
      setFilesB(nextFilesB);
      setHistoryA(nextHistoryA);
      setHistoryB(nextHistoryB);
    }).catch(err => console.error('Failed to load duplicate records:', err));
    return () => {
      isMounted = false;
    };
  }, [isOpen, mediaA.id, mediaB.id]);

  if (!isOpen) return null;

  const survivingMedia = selectedSurvivingId === mediaA.id ? mediaA : mediaB;
  const duplicateMedia = selectedSurvivingId === mediaA.id ? mediaB : mediaA;

  const handleSelectSurviving = (id: string) => {
    setSelectedSurvivingId(id);
    const chosen = id === mediaA.id ? mediaA : mediaB;
    setEditableTitle(chosen.title);
    setEditableYear(chosen.release_year ? String(chosen.release_year) : '');
    setEditableDescription(chosen.description || '');
  };

  const handleConfirmMerge = async () => {
    try {
      const yearNum = editableYear ? parseInt(editableYear, 10) : undefined;
      const overrides: Partial<Media> = {
        title: editableTitle.trim() || survivingMedia.title,
        release_year: yearNum && !isNaN(yearNum) ? yearNum : survivingMedia.release_year,
        description: editableDescription.trim() || survivingMedia.description,
        manually_matched: true,
        updated_at: new Date().toISOString()
      };

      await dbService.mergeMediaEntities(survivingMedia.id, duplicateMedia.id, overrides);
      const merged = (await dbService.getMediaById(survivingMedia.id)) || survivingMedia;

      window.dispatchEvent(new CustomEvent('library-scanned'));
      onMerged(merged);
    } catch (err) {
      console.error('Failed to merge duplicate media:', err);
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'Film':
        return <Film className="w-4 h-4 text-rose-400" />;
      case 'TV Series':
        return <Tv className="w-4 h-4 text-sky-400" />;
      default:
        return <Gamepad2 className="w-4 h-4 text-purple-400" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#14161f] border border-[#2d3145] rounded-2xl w-full max-w-4xl flex flex-col max-h-[90vh] shadow-2xl overflow-hidden animate-fadeIn">
        {/* Header */}
        <div className="p-5 border-b border-[#232736] flex items-center justify-between bg-amber-950/20">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-amber-500/20 border border-amber-500/30 rounded-xl text-amber-400">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Suspected Duplicate Media Detected</h2>
              <p className="text-xs text-amber-300/80">Choose which record to keep. All files and history will be safely combined into the surviving entity.</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-[#1f222e] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6 flex-1 overflow-y-auto">
          {/* Side by side cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[mediaA, mediaB].map(m => {
              const isChosen = selectedSurvivingId === m.id;
              const files = m.id === mediaA.id ? filesA : filesB;
              const history = m.id === mediaA.id ? historyA : historyB;

              return (
                <div
                  key={m.id}
                  onClick={() => handleSelectSurviving(m.id)}
                  className={`relative p-4 rounded-xl border-2 transition-all cursor-pointer flex flex-col justify-between ${
                    isChosen
                      ? 'bg-rose-950/30 border-rose-500 shadow-lg shadow-rose-950/40'
                      : 'bg-[#1b1d2a] border-[#2d3145] hover:border-gray-500'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-start space-x-3">
                      {m.poster ? (
                        <img src={m.poster} alt={m.title} className="w-16 aspect-[2/3] object-cover rounded-lg border border-[#2d3145] shrink-0" />
                      ) : (
                        <div className="w-16 aspect-[2/3] bg-[#232736] rounded-lg shrink-0 flex items-center justify-center border border-[#2d3145]">
                          {getTypeIcon(m.type)}
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2">
                          {getTypeIcon(m.type)}
                          <span className="text-xs font-semibold text-gray-400">{m.type}</span>
                        </div>
                        <h3 className="font-bold text-white text-base truncate">{m.title}</h3>
                        {m.release_year && (
                          <p className="text-xs text-rose-300 font-medium">Year: {m.release_year}</p>
                        )}
                      </div>
                    </div>

                    {m.description && (
                      <p className="text-xs text-gray-400 line-clamp-2 italic">{m.description}</p>
                    )}

                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#232736] text-xs">
                      <div className="flex items-center space-x-1.5 text-gray-300">
                        <HardDrive className="w-3.5 h-3.5 text-sky-400" />
                        <span>{files.length} Local File(s)</span>
                      </div>
                      <div className="flex items-center space-x-1.5 text-gray-300">
                        <History className="w-3.5 h-3.5 text-purple-400" />
                        <span>{history.length} Session(s)</span>
                      </div>
                    </div>

                    {m.external_ids && m.external_ids.length > 0 && (
                      <div className="text-[11px] text-gray-400">
                        External ID: {m.external_ids[0].provider} ({m.external_ids[0].external_id})
                      </div>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-[#232736] flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-400">
                      {isChosen ? 'Selected Canonical Target' : 'Will be merged & deleted'}
                    </span>
                    <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                      isChosen ? 'bg-rose-500 border-rose-400 text-white' : 'border-gray-500'
                    }`}>
                      {isChosen && <Check className="w-3.5 h-3.5" />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Edit attributes before confirming */}
          <div className="bg-[#1b1d2a] border border-[#2d3145] p-4 rounded-xl space-y-3">
            <h4 className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center space-x-2">
              <FileText className="w-4 h-4 text-rose-400" />
              <span>Edit Surviving Canonical Entity Details Before Confirming</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="text-xs text-gray-400 block mb-1">Title</label>
                <input
                  type="text"
                  value={editableTitle}
                  onChange={e => setEditableTitle(e.target.value)}
                  className="w-full bg-[#14161f] border border-[#2d3145] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-rose-500"
                />
              </div>

              <div>
                <label className="text-xs text-gray-400 block mb-1">Release Year</label>
                <input
                  type="number"
                  value={editableYear}
                  onChange={e => setEditableYear(e.target.value)}
                  className="w-full bg-[#14161f] border border-[#2d3145] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-rose-500"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-400 block mb-1">Description / Overview</label>
              <textarea
                rows={2}
                value={editableDescription}
                onChange={e => setEditableDescription(e.target.value)}
                className="w-full bg-[#14161f] border border-[#2d3145] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-rose-500"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#232736] flex items-center justify-end space-x-3 bg-[#11131c]">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-[#2d3145] text-gray-300 hover:bg-[#1a1c29] text-xs font-semibold transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirmMerge}
            className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all shadow-md cursor-pointer flex items-center space-x-1.5"
          >
            <Check className="w-4 h-4" />
            <span>Confirm & Safe Merge Records</span>
          </button>
        </div>
      </div>
    </div>
  );
};
