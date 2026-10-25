import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Media, LocalFile } from '../types/media';
import { dbService } from '../services/DatabaseService';
import { subtitleService, SubtitleTrack } from '../services/SubtitleService';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  X,
  RotateCcw,
  SkipForward,
  Subtitles,
  Sliders,
  AlertTriangle,
  Loader2,
  ChevronRight
} from 'lucide-react';

export interface VideoPlayerModalProps {
  media: Media;
  activeFile: LocalFile;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle?: string;
  initialPosition?: number;
  allLocalFiles?: LocalFile[];
  onClose: () => void;
  onEpisodeChange?: (nextFile: LocalFile, season?: number, episode?: number) => void;
}

export const VideoPlayerModal: React.FC<VideoPlayerModalProps> = ({
  media,
  activeFile,
  seasonNumber = activeFile.season || 1,
  episodeNumber = activeFile.episode || 1,
  episodeTitle,
  initialPosition = 0,
  allLocalFiles = [],
  onClose,
  onEpisodeChange
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Stream URL state
  const [streamUrl, setStreamUrl] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolume] = useState<number>(1);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Subtitles & Audio Tracks
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<string>('off');
  const [audioTracks, setAudioTracks] = useState<{ id: string; label: string }[]>([]);
  const [selectedAudioTrackId, setSelectedAudioTrackId] = useState<string>('');

  // UI Control visibility state
  const [showControls, setShowControls] = useState<boolean>(true);
  const hideControlsTimerRef = useRef<any>(null);

  // Next Episode Countdown state
  const [showNextCountdown, setShowNextCountdown] = useState<boolean>(false);
  const [countdownSeconds, setCountdownSeconds] = useState<number>(5);
  const countdownIntervalRef = useRef<any>(null);

  // Settings: Autoplay Next
  const [autoplayNextSetting, setAutoplayNextSetting] = useState<boolean>(true);

  // Save Progress Throttle
  const lastSavedPosRef = useRef<number>(0);

  // Find Next Episode
  const getNextEpisodeFile = useCallback((): { file: LocalFile; season: number; episode: number } | null => {
    if (media.type !== 'TV Series') return null;

    // First check if a local file exists for season, episode + 1
    let nextEp = episodeNumber + 1;
    let nextSeason = seasonNumber;

    let match = allLocalFiles.find(f =>
      f.exists && f.media_id === media.id && f.season === nextSeason && f.episode === nextEp
    );

    // If not found, check if next season exists (season + 1, ep 1)
    if (!match) {
      nextSeason = seasonNumber + 1;
      nextEp = 1;
      match = allLocalFiles.find(f =>
        f.exists && f.media_id === media.id && f.season === nextSeason && f.episode === nextEp
      );
    }

    if (match) {
      return { file: match, season: nextSeason, episode: nextEp };
    }
    return null;
  }, [media, seasonNumber, episodeNumber, allLocalFiles]);

  const nextEpInfo = getNextEpisodeFile();

  // Load Settings
  useEffect(() => {
    dbService.getSettings().then(s => {
      setAutoplayNextSetting(s.autoplay_next_episode !== false);
    });
  }, []);

  // Resolve Video Stream URL & Subtitles
  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    const resolveStream = async () => {
      try {
        if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
          const { invoke } = await import('@tauri-apps/api/core');
          const url = await invoke<string>('get_video_stream_url', { filePath: activeFile.path });
          if (isMounted) setStreamUrl(url);
        } else {
          // Browser environment fallback
          setStreamUrl(activeFile.path);
        }

        // Discover sidecar subtitles
        const subs = await subtitleService.discoverSubtitlesForVideo(activeFile.path);
        if (isMounted) setSubtitleTracks(subs);
      } catch (err: any) {
        if (isMounted) {
          setError(`Failed to initialize stream for file: ${err?.message || activeFile.filename}`);
          setLoading(false);
        }
      }
    };

    void resolveStream();

    return () => {
      isMounted = false;
    };
  }, [activeFile.path, activeFile.filename]);

  // Handle Video Metadata Loaded & Initial Seek
  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;

    setDuration(video.duration || 0);
    setLoading(false);

    if (initialPosition > 0 && initialPosition < video.duration - 10) {
      video.currentTime = initialPosition;
    }

    // Play video
    video.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));

    // Detect browser Audio Tracks if supported
    if ('audioTracks' in video) {
      const tracks: any = (video as any).audioTracks;
      const parsed = [];
      for (let i = 0; i < tracks.length; i++) {
        parsed.push({ id: String(i), label: tracks[i].label || `Audio Track ${i + 1}` });
      }
      setAudioTracks(parsed);
      if (parsed.length > 0) setSelectedAudioTrackId(parsed[0].id);
    }
  };

  // Save Progress Function
  const saveProgress = useCallback((pos: number, dur: number, forceCompleted: boolean = false) => {
    if (!media.id || dur <= 0) return;
    if (Math.abs(pos - lastSavedPosRef.current) < 1 && !forceCompleted) return;

    lastSavedPosRef.current = pos;
    const now = new Date().toISOString();
    const isCompleted = forceCompleted || (pos / dur >= 0.9);

    void dbService.savePlaybackProgress({
      id: `prog_${media.id}_${seasonNumber}_${episodeNumber}`,
      media_id: media.id,
      season: media.type === 'TV Series' ? seasonNumber : 0,
      episode: media.type === 'TV Series' ? episodeNumber : 0,
      position_seconds: pos,
      duration_seconds: dur,
      updated_at: now,
      is_completed: isCompleted
    });
  }, [media.id, media.type, seasonNumber, episodeNumber]);

  // Periodic Progress Saving
  useEffect(() => {
    const interval = setInterval(() => {
      const video = videoRef.current;
      if (video && !video.paused && video.duration > 0) {
        saveProgress(video.currentTime, video.duration);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [saveProgress]);

  // Auto Controls Hiding
  const handleMouseMove = () => {
    setShowControls(true);
    if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    hideControlsTimerRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 3000);
  };

  // Video Time Update & Completion Logic
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;

    setCurrentTime(video.currentTime);

    // If reached end (>= 98%) or ended, handle next episode countdown
    if (video.duration > 0 && video.currentTime / video.duration >= 0.98 && !showNextCountdown) {
      saveProgress(video.currentTime, video.duration, true);

      if (media.type === 'TV Series' && nextEpInfo && autoplayNextSetting) {
        setShowNextCountdown(true);
        setCountdownSeconds(5);
      }
    }
  };

  // Countdown Interval
  useEffect(() => {
    if (showNextCountdown && countdownSeconds > 0) {
      countdownIntervalRef.current = setTimeout(() => {
        setCountdownSeconds(prev => prev - 1);
      }, 1000);
    } else if (showNextCountdown && countdownSeconds === 0) {
      setShowNextCountdown(false);
      if (nextEpInfo && onEpisodeChange) {
        onEpisodeChange(nextEpInfo.file, nextEpInfo.season, nextEpInfo.episode);
      }
    }

    return () => {
      if (countdownIntervalRef.current) clearTimeout(countdownIntervalRef.current);
    };
  }, [showNextCountdown, countdownSeconds, nextEpInfo, onEpisodeChange]);

  // Play / Pause Toggle
  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
      saveProgress(video.currentTime, video.duration);
    }
  };

  // Seek
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const targetTime = Number(e.target.value);
    const video = videoRef.current;
    if (video) {
      video.currentTime = targetTime;
      setCurrentTime(targetTime);
      saveProgress(targetTime, video.duration);
    }
  };

  // Volume Change
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
      setIsMuted(val === 0);
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      const nextMuted = !isMuted;
      videoRef.current.muted = nextMuted;
      setIsMuted(nextMuted);
    }
  };

  // Speed
  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
  };

  // Fullscreen
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;

      const video = videoRef.current;
      if (!video) return;

      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 10);
          setCurrentTime(video.currentTime);
          break;
        case 'ArrowRight':
          e.preventDefault();
          video.currentTime = Math.min(video.duration, video.currentTime + 10);
          setCurrentTime(video.currentTime);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setVolume(prev => {
            const next = Math.min(1, prev + 0.1);
            if (video) video.volume = next;
            return next;
          });
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume(prev => {
            const next = Math.max(0, prev - 0.1);
            if (video) video.volume = next;
            return next;
          });
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          toggleMute();
          break;
        case 'Escape':
          if (!document.fullscreenElement) {
            e.preventDefault();
            handleExitPlayer();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleExitPlayer = () => {
    const video = videoRef.current;
    if (video && video.duration > 0) {
      saveProgress(video.currentTime, video.duration);
    }
    onClose();
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs)) return '00:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);

    const pad = (n: number) => String(n).padStart(2, '0');
    if (h > 0) {
      return `${h}:${pad(m)}:${pad(s)}`;
    }
    return `${pad(m)}:${pad(s)}`;
  };

  // Header Title Text
  const headerTitle = media.type === 'TV Series'
    ? `${media.title} • S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}${episodeTitle ? ` - ${episodeTitle}` : ''}`
    : media.title;

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className="fixed inset-0 z-50 bg-black flex items-center justify-center overflow-hidden select-none font-sans"
    >
      {/* Video Element */}
      {streamUrl && (
        <video
          ref={videoRef}
          src={streamUrl}
          className="w-full h-full object-contain cursor-pointer"
          onClick={togglePlay}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onError={() => {
            setError(`Playback error: Unsupported format or missing file at ${activeFile.path}`);
            setLoading(false);
          }}
          onEnded={() => {
            setIsPlaying(false);
            if (videoRef.current) {
              saveProgress(videoRef.current.duration, videoRef.current.duration, true);
            }
          }}
        >
          {/* Sidecar Subtitles Tracks */}
          {subtitleTracks.map(sub => (
            <track
              key={sub.id}
              kind="subtitles"
              label={sub.label}
              srcLang={sub.language}
              src={sub.url}
              default={selectedSubtitleId === sub.id}
            />
          ))}
        </video>
      )}

      {/* Loading Spinner */}
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm space-y-3 z-10 pointer-events-none">
          <Loader2 className="w-12 h-12 text-rose-500 animate-spin" />
          <p className="text-sm font-semibold text-gray-200">Buffering Media Stream...</p>
        </div>
      )}

      {/* Error Overlay */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 p-6 text-center space-y-4 z-20">
          <AlertTriangle className="w-16 h-16 text-rose-500" />
          <h3 className="text-xl font-bold text-white">Playback Error Encountered</h3>
          <p className="text-sm text-gray-300 max-w-lg leading-relaxed">{error}</p>
          <div className="flex space-x-3 pt-2">
            <button
              onClick={handleExitPlayer}
              className="bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs px-6 py-2.5 rounded-xl shadow-lg transition-all cursor-pointer"
            >
              Return to Details
            </button>
          </div>
        </div>
      )}

      {/* Top Header Overlay */}
      <div
        className={`absolute top-0 inset-x-0 bg-gradient-to-b from-black/90 via-black/50 to-transparent p-6 flex items-center justify-between transition-opacity duration-300 z-10 ${
          showControls || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center space-x-3 text-white truncate max-w-2xl">
          <h2 className="text-lg md:text-xl font-bold truncate drop-shadow">{headerTitle}</h2>
        </div>

        <div className="flex items-center space-x-3">
          {/* TV Show Episode Selector Dropdown */}
          {media.type === 'TV Series' && allLocalFiles.length > 1 && (
            <div className="relative group">
              <select
                value={`${seasonNumber}_${episodeNumber}`}
                onChange={(e) => {
                  const [s, ep] = e.target.value.split('_').map(Number);
                  const matched = allLocalFiles.find(f => f.exists && f.season === s && f.episode === ep);
                  if (matched && onEpisodeChange) {
                    onEpisodeChange(matched, s, ep);
                  }
                }}
                className="bg-black/60 border border-white/20 text-white text-xs rounded-xl px-3 py-1.5 backdrop-blur-md cursor-pointer hover:bg-black/80"
              >
                {allLocalFiles
                  .filter(f => f.exists && f.season !== undefined && f.episode !== undefined)
                  .map(f => (
                    <option key={f.id} value={`${f.season}_${f.episode}`} className="bg-[#14161f] text-white">
                      S{String(f.season).padStart(2, '0')}E{String(f.episode).padStart(2, '0')} - {f.filename}
                    </option>
                  ))}
              </select>
            </div>
          )}

          <button
            onClick={handleExitPlayer}
            className="p-2 rounded-full bg-black/50 hover:bg-rose-600 text-white backdrop-blur-md transition-colors cursor-pointer"
            title="Close Player (Esc)"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Next Episode Countdown Overlay */}
      {showNextCountdown && nextEpInfo && (
        <div className="absolute bottom-24 right-8 bg-[#151722]/90 border border-rose-500/50 backdrop-blur-md p-5 rounded-2xl shadow-2xl space-y-3 z-30 animate-fadeIn max-w-sm">
          <div className="flex items-center space-x-2 text-rose-400 font-bold text-xs">
            <SkipForward className="w-4 h-4" />
            <span>Up Next in {countdownSeconds}s</span>
          </div>

          <p className="text-sm font-bold text-white truncate">
            S{String(nextEpInfo.season).padStart(2, '0')}E{String(nextEpInfo.episode).padStart(2, '0')} - {nextEpInfo.file.filename}
          </p>

          <div className="flex items-center space-x-2 pt-1">
            <button
              onClick={() => {
                if (countdownIntervalRef.current) clearTimeout(countdownIntervalRef.current);
                setShowNextCountdown(false);
              }}
              className="px-3.5 py-1.5 rounded-xl border border-white/20 text-gray-300 hover:bg-white/10 text-xs font-semibold cursor-pointer"
            >
              Cancel
            </button>

            <button
              onClick={() => {
                if (countdownIntervalRef.current) clearTimeout(countdownIntervalRef.current);
                setShowNextCountdown(false);
                if (onEpisodeChange) {
                  onEpisodeChange(nextEpInfo.file, nextEpInfo.season, nextEpInfo.episode);
                }
              }}
              className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-md cursor-pointer flex items-center space-x-1"
            >
              <span>Play Now</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Bottom Control Bar Overlay */}
      <div
        className={`absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-6 space-y-3 transition-opacity duration-300 z-10 ${
          showControls || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Seekbar Progress Slider */}
        <div className="relative group flex items-center">
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-1.5 bg-white/20 hover:h-2.5 rounded-lg appearance-none cursor-pointer accent-rose-500 transition-all"
          />
        </div>

        {/* Controls Row */}
        <div className="flex items-center justify-between text-white">
          <div className="flex items-center space-x-4">
            {/* Play/Pause */}
            <button
              onClick={togglePlay}
              className="p-2 rounded-full hover:bg-white/20 text-white transition-colors cursor-pointer"
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            >
              {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 fill-current" />}
            </button>

            {/* Restart From Beginning */}
            <button
              onClick={() => {
                if (videoRef.current) {
                  videoRef.current.currentTime = 0;
                  setCurrentTime(0);
                }
              }}
              className="p-2 rounded-full hover:bg-white/20 text-gray-300 hover:text-white transition-colors cursor-pointer"
              title="Restart from Beginning"
            >
              <RotateCcw className="w-5 h-5" />
            </button>

            {/* Next Episode Button if available */}
            {media.type === 'TV Series' && nextEpInfo && (
              <button
                onClick={() => {
                  if (onEpisodeChange) {
                    onEpisodeChange(nextEpInfo.file, nextEpInfo.season, nextEpInfo.episode);
                  }
                }}
                className="p-2 rounded-full hover:bg-white/20 text-gray-300 hover:text-white transition-colors cursor-pointer"
                title={`Next Episode (S${String(nextEpInfo.season).padStart(2, '0')}E${String(nextEpInfo.episode).padStart(2, '0')})`}
              >
                <SkipForward className="w-5 h-5" />
              </button>
            )}

            {/* Volume */}
            <div className="flex items-center space-x-2 group">
              <button
                onClick={toggleMute}
                className="p-1.5 rounded-full hover:bg-white/20 text-white transition-colors cursor-pointer"
              >
                {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="w-16 h-1 bg-white/30 rounded appearance-none cursor-pointer accent-rose-500 opacity-80 group-hover:opacity-100 transition-opacity"
              />
            </div>

            {/* Time Stamp */}
            <div className="text-xs font-mono text-gray-300 pl-2">
              <span>{formatTime(currentTime)}</span>
              <span className="text-gray-500 mx-1">/</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {/* Playback Speed Selector */}
            <div className="relative flex items-center space-x-1 text-xs">
              <Sliders className="w-4 h-4 text-gray-400" />
              <select
                value={playbackSpeed}
                onChange={(e) => handleSpeedChange(Number(e.target.value))}
                className="bg-black/60 border border-white/20 text-white text-xs rounded-lg px-2 py-1 backdrop-blur-md cursor-pointer hover:bg-black/80"
              >
                <option value={0.5} className="bg-[#14161f]">0.5x</option>
                <option value={0.75} className="bg-[#14161f]">0.75x</option>
                <option value={1.0} className="bg-[#14161f]">1.0x Normal</option>
                <option value={1.25} className="bg-[#14161f]">1.25x</option>
                <option value={1.5} className="bg-[#14161f]">1.5x</option>
                <option value={2.0} className="bg-[#14161f]">2.0x</option>
              </select>
            </div>

            {/* Subtitles Selector */}
            {subtitleTracks.length > 0 && (
              <div className="relative flex items-center space-x-1 text-xs">
                <Subtitles className="w-4 h-4 text-rose-400" />
                <select
                  value={selectedSubtitleId}
                  onChange={(e) => setSelectedSubtitleId(e.target.value)}
                  className="bg-black/60 border border-white/20 text-white text-xs rounded-lg px-2 py-1 backdrop-blur-md cursor-pointer hover:bg-black/80"
                >
                  <option value="off" className="bg-[#14161f]">Subtitles Off</option>
                  {subtitleTracks.map(sub => (
                    <option key={sub.id} value={sub.id} className="bg-[#14161f]">
                      {sub.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Audio Track Selector if available */}
            {audioTracks.length > 1 && (
              <select
                value={selectedAudioTrackId}
                onChange={(e) => {
                  setSelectedAudioTrackId(e.target.value);
                  const video = videoRef.current;
                  if (video && 'audioTracks' in video) {
                    const tracks: any = (video as any).audioTracks;
                    for (let i = 0; i < tracks.length; i++) {
                      tracks[i].enabled = String(i) === e.target.value;
                    }
                  }
                }}
                className="bg-black/60 border border-white/20 text-white text-xs rounded-lg px-2 py-1 backdrop-blur-md cursor-pointer hover:bg-black/80"
              >
                {audioTracks.map(at => (
                  <option key={at.id} value={at.id} className="bg-[#14161f]">
                    {at.label}
                  </option>
                ))}
              </select>
            )}

            {/* Fullscreen Toggle */}
            <button
              onClick={toggleFullscreen}
              className="p-2 rounded-full hover:bg-white/20 text-white transition-colors cursor-pointer"
              title="Fullscreen (F)"
            >
              {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
