import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Media, LocalFile } from '../types/media';
import { dbService } from '../services/DatabaseService';
import { subtitleService, SubtitleTrack } from '../services/SubtitleService';
import { localScannerService } from '../services/LocalScannerService';
import { createMkvSubtitleExtractor, extractMkvSubtitleTracks } from '../services/SubtitleExtraction';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  ArrowLeft,
  RotateCw,
  RotateCcw,
  SkipForward,
  Subtitles,
  Sliders,
  AlertTriangle,
  Loader2,
  ChevronRight,
  ChevronDown,
  AudioLines
} from 'lucide-react';

interface NativeAudioTrack {
  label?: string;
  language?: string;
  enabled: boolean;
}

interface NativeAudioTrackList {
  length: number;
  [index: number]: NativeAudioTrack;
}

interface VideoWithAudioTracks extends HTMLVideoElement {
  audioTracks?: NativeAudioTrackList;
}

interface EmbeddedSubtitleTrack {
  id: string;
  label: string;
  track: TextTrack;
}

export interface VideoPlayerModalProps {
  media: Media;
  activeFile: LocalFile;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle?: string;
  initialPosition?: number;
  allLocalFiles?: LocalFile[];
  sideBarIsCollapsed: boolean;
  sidebarHideEnabled?: boolean;
  onClose: () => void;
  onEpisodeChange?: (nextFile: LocalFile, season?: number, episode?: number, title?: string) => void;
}

export const VideoPlayerModal: React.FC<VideoPlayerModalProps> = ({
  media,
  activeFile,
  seasonNumber = activeFile.season || 1,
  episodeNumber = activeFile.episode || 1,
  episodeTitle,
  initialPosition = 0,
  allLocalFiles = [],
  sideBarIsCollapsed = false,
  sidebarHideEnabled = false,
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
  const [audioSettingsLoaded, setAudioSettingsLoaded] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Subtitles & Audio Tracks
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [embeddedSubtitleTracks, setEmbeddedSubtitleTracks] = useState<EmbeddedSubtitleTrack[]>([]);
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<string>('off');
  const [subtitleTracksLoaded, setSubtitleTracksLoaded] = useState<boolean>(false);
  const [videoMetadataLoaded, setVideoMetadataLoaded] = useState<boolean>(false);
  const [subtitleAutoSelectionDone, setSubtitleAutoSelectionDone] = useState<boolean>(false);
  const [lastSelectedSubtitleId, setLastSelectedSubtitleId] = useState(0);
  const [subtitleError, setSubtitleError] = useState<string | null>(null);
  const [activeSubtitleText, setActiveSubtitleText] = useState('');
  const [audioTracks, setAudioTracks] = useState<{ id: string; label: string }[]>([]);
  const [selectedAudioTrackId, setSelectedAudioTrackId] = useState<string>('');
  const [audioTrackSupport, setAudioTrackSupport] = useState<boolean | null>(null);
  const subtitleTrackElementsRef = useRef(new Map<string, HTMLTrackElement>());

  // UI Control visibility state
  const [showControls, setShowControls] = useState<boolean>(true);
  const [showSeekLeft, setShowSeekLeft] = useState(false);
  const [showSeekRight, setShowSeekRight] = useState(false);
  const [showVolumeChange, setShowVolumeChange] = useState(false);
  const hideControlsTimerRef = useRef<any>(null);
  const [isEpisodePickerOpen, setIsEpisodePickerOpen] = useState(false);
  const [selectedPickerSeason, setSelectedPickerSeason] = useState(seasonNumber);

  // Next Episode Countdown state
  const [showNextCountdown, setShowNextCountdown] = useState<boolean>(false);
  const [countdownSeconds, setCountdownSeconds] = useState<number>(5);
  const [countdownCancelled, setCountdownCancelled] = useState<boolean>(false);
  const countdownIntervalRef = useRef<any>(null);

  // Settings: Autoplay Next
  const [autoplayNextSetting, setAutoplayNextSetting] = useState<boolean>(true);

  // Save Progress Throttle
  const lastSavedPosRef = useRef<number>(0);

  const volumeTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [mkvParsing, setMkvParsing] = useState<boolean>(false);

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
  const pickerSeasons = Array.from(new Set(
    allLocalFiles
      .filter(file => file.exists && file.season !== undefined && file.episode !== undefined)
      .map(file => file.season!)
  )).sort((a, b) => a - b);
  const getEpisodeTitle = useCallback((file: LocalFile, season: number, episode: number) => (
    media.seasons
      ?.find(item => item.season_number === season)
      ?.episodes?.find(item => item.episode_number === episode)?.name
    || file.parsed_title
    || file.filename
  ), [media.seasons]);
  const getEpisodeDetails = (season: number, episode: number) =>
    media.seasons
      ?.find(item => item.season_number === season)
      ?.episodes?.find(item => item.episode_number === episode);
  
    const cycleSubtitles = useCallback(() => {
     // Toggle on/off between available tracks and "off"
     const allTracks = [...subtitleTracks, ...embeddedSubtitleTracks];

     if (allTracks.length === 0) return;

     let currentIndex = allTracks.findIndex(track =>
       selectedSubtitleId === `sidecar:${track.id}` || selectedSubtitleId === track.id
     );

     if (currentIndex >= 0) {
       // If currently enabled, move to next (or off at end)
       currentIndex = (currentIndex + 1) % (allTracks.length + 1);
       setLastSelectedSubtitleId(currentIndex);
     } else {
       // Start from beginning
       currentIndex = allTracks.length > 0 ? 0 : 0;
     }

     const targetTrack = currentIndex >= allTracks.length
       ? 'off'
       : `sidecar:${allTracks[currentIndex].id}`;

     setSelectedSubtitleId(targetTrack);
   }, [selectedSubtitleId, subtitleTracks, embeddedSubtitleTracks, lastSelectedSubtitleId]);

   const toggleSubtitles = useCallback(() => {
     // Toggle on/off between available tracks and "off"
     const allTracks = [...subtitleTracks, ...embeddedSubtitleTracks];

     if (allTracks.length === 0) return;

     let currentIndex = allTracks.findIndex(track =>
       selectedSubtitleId === `sidecar:${track.id}` || selectedSubtitleId === track.id
     );

     if (currentIndex < 0) {
      if(lastSelectedSubtitleId >= 0 && lastSelectedSubtitleId < allTracks.length)
        currentIndex = lastSelectedSubtitleId;
      else
        currentIndex = 0;
     } else {
       setLastSelectedSubtitleId(currentIndex);
       currentIndex = allTracks.length;
     }

     const targetTrack = currentIndex >= allTracks.length
       ? 'off'
       : `sidecar:${allTracks[currentIndex].id}`;

     setSelectedSubtitleId(targetTrack);
   }, [selectedSubtitleId, subtitleTracks, embeddedSubtitleTracks, setLastSelectedSubtitleId]);

  // Load Settings
  useEffect(() => {
    dbService.getSettings().then(s => {
      setAutoplayNextSetting(s.autoplay_next_episode !== false);
      const audioSettings = s.player_audio_settings;
      if (audioSettings && Number.isFinite(audioSettings.volume)) {
        setVolume(Math.min(1, Math.max(0, audioSettings.volume)));
        setIsMuted(audioSettings.muted === true);
      }
      setAudioSettingsLoaded(true);
    }).catch(error => {
      console.error('Failed to load player audio settings:', error);
    });
  }, []);

  useEffect(() => {
    if (!audioSettingsLoaded) return;
    void dbService.saveSetting('player_audio_settings', { volume, muted: isMuted }).catch(error => {
      console.error('Failed to save player audio settings:', error);
    });
  }, [audioSettingsLoaded, volume, isMuted]);

  useEffect(() => () => {
    for (const track of subtitleTracks) {
      if (track.url.startsWith('blob:')) URL.revokeObjectURL(track.url);
    }
  }, [subtitleTracks]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = isMuted;
  }, [streamUrl, volume, isMuted]);

  // Resolve Video Stream URL & Subtitles
  useEffect(() => {
    let isMounted = true;
    let objectUrl: string | undefined;
    setLoading(true);
    setError(null);
    setStreamUrl('');
    setSubtitleTracks([]);
    setEmbeddedSubtitleTracks([]);
    setSelectedSubtitleId('off');
    setSubtitleTracksLoaded(false);
    setVideoMetadataLoaded(false);
    setSubtitleAutoSelectionDone(false);
    setSubtitleError(null);
    setActiveSubtitleText('');
    setAudioTracks([]);
    setSelectedAudioTrackId('');
    setAudioTrackSupport(null);
    setMkvParsing(false);

    const loadSubtitleTracks = async (webFile?: File) => {
      const discoveredTracks: SubtitleTrack[] = [];
      try {
        discoveredTracks.push(...await subtitleService.discoverSubtitlesForVideo(activeFile.path));
      } catch (subtitleLoadError) {
        const message = subtitleLoadError instanceof Error
          ? subtitleLoadError.message
          : String(subtitleLoadError);
        console.error('Failed to discover subtitle tracks:', subtitleLoadError);
        if (isMounted) setSubtitleError(message);
      }

      const isMkv = activeFile.path.toLowerCase().endsWith('.mkv');
      if (isMkv) {
        if (isMounted) setMkvParsing(true);
        try {
          let bytes: ArrayBuffer | Uint8Array;
          let extractedSubtitles;
          if (webFile) {
            bytes = await webFile.arrayBuffer();
            extractedSubtitles = extractMkvSubtitleTracks(bytes);
          } else if (typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)) {
            const { open } = await import('@tauri-apps/plugin-fs');
            const file = await open(activeFile.path);
            const extractor = createMkvSubtitleExtractor();
            const chunk = new Uint8Array(4 * 1024 * 1024);
            try {
              while (true) {
                const bytesRead = await file.read(chunk);
                if (bytesRead === null || bytesRead === 0) break;
                extractor.push(chunk.subarray(0, bytesRead));
              }
              extractedSubtitles = extractor.finish();
            } finally {
              await file.close();
            }
          } else {
            throw new Error('The MKV file is not available for embedded subtitle extraction.');
          }

          const extractedTracks = extractedSubtitles.map(track => ({
            id: track.id,
            label: track.label,
            language: track.language,
            url: URL.createObjectURL(new Blob([track.webVtt], { type: 'text/vtt;charset=utf-8' })),
            embedded: true
          }));
          discoveredTracks.push(...extractedTracks);
        } catch (subtitleParseError) {
          const message = subtitleParseError instanceof Error
            ? subtitleParseError.message
            : String(subtitleParseError);
          console.error('Failed to extract embedded MKV subtitles:', subtitleParseError);
          if (isMounted) setSubtitleError(message);
        } finally {
          if (isMounted) setMkvParsing(false);
        }
      }

      if (isMounted) {
        setSubtitleTracks(discoveredTracks);
        setSubtitleTracksLoaded(true);
      }
      else {
        for (const track of discoveredTracks) {
          if (track.url.startsWith('blob:')) URL.revokeObjectURL(track.url);
        }
      }
    };

    const resolveStream = async () => {
      try {
        const selectedFile = localScannerService.getWebSelectedFile(media.type, activeFile.path);
        if (selectedFile) {
          objectUrl = URL.createObjectURL(selectedFile);
          if (isMounted) setStreamUrl(objectUrl);
          void loadSubtitleTracks(selectedFile);
          return;
        }

        if (typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)) {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('grant_video_files_access', { videoPath: activeFile.path });
          const url = await invoke<string>('get_video_stream_url', { filePath: activeFile.path });
          if (isMounted) setStreamUrl(url);
          void loadSubtitleTracks();
        } else {
          setStreamUrl(activeFile.path);
          void loadSubtitleTracks();
        }
      } catch (err) {
        if (isMounted) {
          const message = err instanceof Error ? err.message : String(err);
          setError(`Failed to initialize stream for file: ${message || activeFile.filename}`);
          setLoading(false);
        }
      }
    };

    void resolveStream();

    return () => {
      isMounted = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activeFile.path, activeFile.filename, media.type]);

  const discoverEmbeddedSubtitleTracks = useCallback(() => {
    const textTracks = videoRef.current?.textTracks;
    if (!textTracks) {
      setEmbeddedSubtitleTracks([]);
      return;
    }

    const sidecarElements = new Set(subtitleTrackElementsRef.current.values());
    const embedded = Array.from({ length: textTracks.length }, (_, index) => {
      const track = textTracks[index];
      if (
        !['subtitles', 'captions'].includes(track.kind)
        || Array.from(sidecarElements).some(element => element.track === track)
      ) return null;

      return {
        id: `embedded:${index}`,
        label: track.label || track.language || `Embedded subtitle ${index + 1}`,
        track
      };
    }).filter((track): track is EmbeddedSubtitleTrack => track !== null);

    setEmbeddedSubtitleTracks(embedded);
  }, []);

  useEffect(() => {
    const textTracks = videoRef.current?.textTracks;
    if (!textTracks) return;

    const handleTrackListChange = () => discoverEmbeddedSubtitleTracks();
    textTracks.addEventListener('addtrack', handleTrackListChange);
    textTracks.addEventListener('removetrack', handleTrackListChange);
    discoverEmbeddedSubtitleTracks();

    return () => {
      textTracks.removeEventListener('addtrack', handleTrackListChange);
      textTracks.removeEventListener('removetrack', handleTrackListChange);
    };
  }, [streamUrl, subtitleTracks, discoverEmbeddedSubtitleTracks]);

  useEffect(() => {
    if (!subtitleTracksLoaded || !videoMetadataLoaded || subtitleAutoSelectionDone) return;

    const preferredTrack = subtitleTracks.find(track => track.embedded)
      || embeddedSubtitleTracks[0]
      || subtitleTracks[0];
    if (!preferredTrack) return;

    setSelectedSubtitleId('track' in preferredTrack
      ? preferredTrack.id
      : `sidecar:${preferredTrack.id}`);
    setSubtitleAutoSelectionDone(true);
  }, [
    subtitleTracksLoaded,
    videoMetadataLoaded,
    subtitleAutoSelectionDone,
    subtitleTracks,
    embeddedSubtitleTracks
  ]);

  const applySubtitleSelection = useCallback((selectedId: string) => {
    setActiveSubtitleText('');
    for (const [id, element] of subtitleTrackElementsRef.current) {
      const track = element.track;
      const trackId = `sidecar:${id}`;
      track.oncuechange = trackId === selectedId
        ? () => {
            const cues = track.activeCues;
            setActiveSubtitleText(cues
              ? Array.from(cues)
                .map(cue => cue instanceof VTTCue ? cue.text : '')
                .filter(Boolean)
                .join('\n')
              : '');
          }
        : null;
      track.mode = trackId === selectedId ? 'hidden' : 'disabled';
    }
    for (const { id, track } of embeddedSubtitleTracks) {
      track.oncuechange = id === selectedId
        ? () => {
            const cues = track.activeCues;
            setActiveSubtitleText(cues
              ? Array.from(cues)
                .map(cue => cue instanceof VTTCue ? cue.text : '')
                .filter(Boolean)
                .join('\n')
              : '');
          }
        : null;
      track.mode = id === selectedId ? 'hidden' : 'disabled';
    }
  }, [embeddedSubtitleTracks]);

  useEffect(() => {
    applySubtitleSelection(selectedSubtitleId);
  }, [applySubtitleSelection, selectedSubtitleId]);

  const applyAudioSelection = useCallback((selectedId: string) => {
    const tracks = (videoRef.current as VideoWithAudioTracks | null)?.audioTracks;
    if (!tracks) return;

    for (let index = 0; index < tracks.length; index++) {
      tracks[index].enabled = String(index) === selectedId;
    }
  }, []);

  useEffect(() => {
    applyAudioSelection(selectedAudioTrackId);
  }, [applyAudioSelection, selectedAudioTrackId, audioTracks]);

  const discoverAudioTracks = () => {
    const video = videoRef.current as VideoWithAudioTracks | null;
    const tracks = video?.audioTracks;
    if (!tracks) {
      setAudioTracks([]);
      setSelectedAudioTrackId('');
      setAudioTrackSupport(Boolean(video && 'audioTracks' in video));
      return;
    }

    setAudioTrackSupport(true);
    const parsedTracks = Array.from({ length: tracks.length }, (_, index) => ({
      id: String(index),
      label: tracks[index].label || tracks[index].language || `Audio Track ${index + 1}`
    }));
    setAudioTracks(parsedTracks);
    const enabledTrackIndex = Array.from({ length: tracks.length })
      .findIndex((_, index) => tracks[index].enabled);
    setSelectedAudioTrackId(String(enabledTrackIndex >= 0 ? enabledTrackIndex : 0));
  };

  // Handle Video Metadata Loaded & Initial Seek
  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;

    setDuration(video.duration || 0);
    setLoading(false);
    discoverEmbeddedSubtitleTracks();
    setVideoMetadataLoaded(true);

    if (initialPosition > 0 && initialPosition < video.duration - 10) {
      video.currentTime = initialPosition;
    }

    // Play video
    video.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));

    discoverAudioTracks();
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
        setIsEpisodePickerOpen(false);
      }
    }, 3000);
  };

  // Video Time Update & Completion Logic
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;

    setCurrentTime(video.currentTime);

    // If reached end (>= 98%) or ended, handle next episode countdown
    if (video.duration > 0 && video.currentTime / video.duration >= 0.98 && !showNextCountdown && !countdownCancelled) {
      saveProgress(video.currentTime, video.duration, true);

      if (media.type === 'TV Series' && nextEpInfo && autoplayNextSetting) {
        setShowNextCountdown(true);
        setCountdownSeconds(5);
      }
    } else if (video.duration > 0 && video.currentTime / video.duration < 0.95) {
      // If user seeks back, hide the countdown and reset cancellation
      setShowNextCountdown(false);
      setCountdownCancelled(false);
    }
  };

  // Countdown Interval - Always count down regardless of play/pause
  useEffect(() => {
    // Always set new interval to ensure it fires at right time (next render)
    if (showNextCountdown && countdownSeconds > 0) {
      
       if (isPlaying) {
        countdownIntervalRef.current = setTimeout(() => {
          setCountdownSeconds(prev => prev - 1);
        }, 1000);
      } else {
        // If paused, clear any active running timeouts
        if (countdownIntervalRef.current) {
          clearTimeout(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
        }
      }
      
      return () => {
        if (countdownIntervalRef.current) clearTimeout(countdownIntervalRef.current);
      };
    }
    else if (showNextCountdown && countdownSeconds === 0) {
      // Countdown finished - transition to next episode
      setShowNextCountdown(false);
      if (nextEpInfo && onEpisodeChange) {
        setCountdownCancelled(false);
        onEpisodeChange(
          nextEpInfo.file,
          nextEpInfo.season,
          nextEpInfo.episode,
          getEpisodeTitle(nextEpInfo.file, nextEpInfo.season, nextEpInfo.episode)
        );
      

      }
      if (countdownIntervalRef.current) clearTimeout(countdownIntervalRef.current);
    } else {
      // Cancelled
      if (countdownIntervalRef.current) {
        clearTimeout(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    }
    
    return () => {
      if (countdownIntervalRef.current) clearTimeout(countdownIntervalRef.current);
    };
  }, [showNextCountdown, countdownSeconds, isPlaying]);

  // Play / Pause Toggle
  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    setIsEpisodePickerOpen(false);

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

  const toggleMute = useCallback(() => {
    if (videoRef.current) {
      const nextMuted = !isMuted;
      videoRef.current.muted = nextMuted;
      setIsMuted(nextMuted);
    }
  }, [isMuted]);

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
          setShowSeekLeft(true);
          setShowSeekRight(false);
          setTimeout(() => setShowSeekLeft(false), 800);
          if (e.shiftKey) {
            video.currentTime = Math.max(0, video.currentTime - 5);
          } else {
            video.currentTime = Math.max(0, video.currentTime - 10);
          }
          setCurrentTime(video.currentTime);
          break;
        case 'ArrowRight':
          e.preventDefault();
          setShowSeekLeft(true);
          setShowSeekRight(false);
          setTimeout(() => setShowSeekLeft(false), 800);
          if (e.shiftKey) {
            video.currentTime = Math.max(0, video.currentTime + 5);
          } else {
            video.currentTime = Math.max(0, video.currentTime + 10);
          }
          setCurrentTime(video.currentTime);
          break;
        case 'ArrowUp':
          e.preventDefault();
          
          // Clear any active timer so it restarts
          if (volumeTimerRef.current) {
            clearTimeout(volumeTimerRef.current);
          }
          setShowVolumeChange(false);
          // Set the new timer
          volumeTimerRef.current = setTimeout(() => {
            setShowVolumeChange(false);
          }, 800);
          setShowVolumeChange(true);

          setVolume(prev => {
            const next = Math.min(1, prev + 0.1);
            video.volume = next; // 1. Update DOM first
            setVolume(next);     // 2. Sync React state
            return next;
          });
          break;
        case 'ArrowDown':
          e.preventDefault();

          // Clear any active timer so it restarts
          if (volumeTimerRef.current) {
            clearTimeout(volumeTimerRef.current);
          }

          // Set the new timer
          volumeTimerRef.current = setTimeout(() => {
            setShowVolumeChange(false);
          }, 800);
          setShowVolumeChange(true);

          setVolume(prev => {
            const next = Math.max(0, prev - 0.1);
            video.volume = next; // 1. Update DOM first
            setVolume(next);   
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
        case 'v':
        case 'V':
          if (e.shiftKey) {
            e.preventDefault();
            toggleSubtitles()
            console.log("Shift + V pressed");
          } else {
            e.preventDefault();
            cycleSubtitles();
          }
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
  }, [togglePlay, toggleMute, toggleFullscreen]);

  const handleExitPlayer = () => {
    const video = videoRef.current;
    if (video && video.duration > 0) {
      saveProgress(video.currentTime, video.duration);
    }
    onClose();
  };

  const handleVideoTouch = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;

    const touch = e.touches[0]; // Accessing the first touch item
    const now = e.timeStamp;
    
    // Use type assertion to safely access the dataset from currentTarget
    const currentTarget = e.currentTarget as HTMLDivElement;
    const lastTap = parseFloat(currentTarget.dataset.lastTap || '0');
    const delay = now - lastTap;

    if (delay > 0 && delay < 300) {
      e.preventDefault(); 
      
      const rect = currentTarget.getBoundingClientRect();
      const touchX = touch.clientX - rect.left;
      const midPoint = rect.width / 2;

      if (touchX < midPoint) {
        handleDoubleTapLeft();
      } else {
        handleDoubleTapRight();
      }

      currentTarget.dataset.lastTap = '0';
    } else {
      currentTarget.dataset.lastTap = now.toString();
    }
  };

  const handleDoubleTapLeft = () => {
    setShowSeekLeft(true);
    setTimeout(() => setShowSeekLeft(false), 800);
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10);
    }
  };

  const handleDoubleTapRight = () => {
    setShowSeekRight(true);
    setTimeout(() => setShowSeekRight(false), 800);
    if (videoRef.current) {
      videoRef.current.currentTime = Math.min(videoRef.current.duration, videoRef.current.currentTime + 10);
    }
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
    ? `${media.title} `//• S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}${episodeTitle ? ` - ${episodeTitle}` : ''}`
    : media.title;
  const subHeader = media.type === 'TV Series'? 
    `S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}${episodeTitle ? ` - ${episodeTitle}` : ''}`
    : ''
  const controlsLeftOffset = isFullscreen ? 'left-0' : (sidebarHideEnabled ? 'left-0' : (!sideBarIsCollapsed ? 'left-64' : 'left-20'));
  const backButtonLeftOffset = isFullscreen
    ? 'sidebar:left-4'
    : (sidebarHideEnabled ? 'sidebar:left-4' : sideBarIsCollapsed
      ? 'sidebar:left-[6.5rem]'
      : 'sidebar:left-[17.5rem]');
  
  return (
    <div
      ref={containerRef}
      onTouchStart={handleVideoTouch} 
      onMouseMove={handleMouseMove}
      onClick={() => setIsEpisodePickerOpen(false)}
      className="fixed inset-0 z-50 bg-black flex items-center justify-center overflow-hidden select-none font-sans"
    >
      {/* Centered Play Icon Wrapper */}
      {!isPlaying && !showVolumeChange && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <div className="animate-[ping_0.15s_cubic-bezier(0.175,0.885,0.32,1.275)_reverse] transform origin-center">
            <Play className="h-16 w-16 fill-current text-white opacity-80 drop-shadow-2xl" />
          </div>
        </div>
      )}

      {/* Centered Play Icon Wrapper */}
      {showVolumeChange && (
        
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <div className="animate-[ping_0.15s_ease-in_reverse] transform origin-center">
            {volume === 0 ? (
              <VolumeX className="h-16 w-16 fill-current text-white opacity-80 drop-shadow-2xl" />
            ) : (
              <Volume2 className="h-16 w-16 fill-current text-white opacity-80 drop-shadow-2xl" />
            )}
          </div>
        </div>
      )}

      {/* Seek Overlays */}
      <div className="absolute inset-0 pointer-events-none z-20 flex items-center justify-between px-20">
        <div className={`flex items-center justify-center w-16 h-16 rounded-full bg-white/10 backdrop-blur-sm text-white drop-shadow-lg transition-opacity duration-300 ${showSeekLeft ? 'opacity-100' : 'opacity-0'}`}>
          <RotateCcw className="h-8 w-8" />
        </div>
        <div className={`flex items-center justify-center w-16 h-16 rounded-full bg-white/10 backdrop-blur-sm text-white drop-shadow-lg transition-opacity duration-300 ${showSeekRight ? 'opacity-100' : 'opacity-0'}`}>
          <RotateCw  className="h-8 w-8" />
        </div>
      </div>
      {/* Video Element */}
      {streamUrl && (
        <video
          ref={videoRef}
          src={streamUrl}
          className="w-full h-full object-contain cursor-pointer"
          onClick={togglePlay}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onError={(e) => {
            const vid = e.currentTarget;
            const code = vid.error?.code;
            const msg = vid.error?.message;
            console.error('[VideoPlayer] onError', { src: streamUrl, error: vid.error });
            setError(`Playback error: ${msg || (code === 4 ? 'Unsupported format or codec' : 'File cannot be read')} at ${activeFile.path}`);
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
              ref={element => {
                if (element) {
                  subtitleTrackElementsRef.current.set(sub.id, element);
                  element.track.mode = selectedSubtitleId === `sidecar:${sub.id}` ? 'hidden' : 'disabled';
                } else {
                  subtitleTrackElementsRef.current.delete(sub.id);
                }
              }}
              kind="subtitles"
              label={sub.label}
              srcLang={sub.language}
              src={sub.url}
              onLoad={() => {
                discoverEmbeddedSubtitleTracks();
                applySubtitleSelection(selectedSubtitleId);
              }}
              onError={() => {
                setSubtitleError(`Could not load subtitle track "${sub.label}".`);
              }}
            />
          ))}
        </video>
      )}
      
      {activeSubtitleText && (
        <div
          aria-live="off"
          className= {`pointer-events-none absolute  ${showControls ? 'bottom-[18%]' : 'bottom-[5%]'} left-1/2 z-20 max-w-[85vw] -translate-x-1/2 whitespace-pre-line rounded bg-black/70 px-3 py-1.5 text-center text-base font-semibold leading-relaxed text-white shadow-[0_2px_6px_rgba(0,0,0,0.9)] sm:text-xl`}
        >
          {activeSubtitleText}
        </div>
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

      {media.type === 'TV Series' && allLocalFiles.length > 1 && (
        <div
          onClick={event => event.stopPropagation()}
          className={`absolute top-4 right-4 z-30 transition-opacity duration-300 ${
            showControls || !isPlaying ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <button
            type="button"
            onClick={() => {
              setSelectedPickerSeason(seasonNumber);
              setIsEpisodePickerOpen(open => !open);
            }}
            aria-expanded={isEpisodePickerOpen}
            className="flex items-center gap-1.5 rounded-xl border border-white/15 bg-[#111319]/90 px-3 py-2 text-xs font-semibold text-white shadow-xl backdrop-blur-xl transition-colors hover:bg-[#1a1d26] sm:gap-2 sm:px-4 sm:py-2.5 sm:text-sm"
          >
            <span>S{String(seasonNumber).padStart(2, '0')}E{String(episodeNumber).padStart(2, '0')}</span>
            <ChevronDown className={`h-4 w-4 transition-transform ${isEpisodePickerOpen ? 'rotate-180' : ''}`} />
          </button>

          {isEpisodePickerOpen && (
            <div className="absolute right-0 top-14 flex h-[18rem] max-h-[max(0px,calc(100dvh-12rem-var(--sab,0px)))] w-[calc(100vw-2rem)] max-w-2xl flex-col overflow-hidden rounded-xl border border-white/10 bg-[#111319]/95 shadow-2xl backdrop-blur-2xl sm:w-[min(42rem,calc(100vw-2rem))] sidebar:h-[min(36rem,max(0px,calc(100dvh-12rem-var(--sab,0px))))] sidebar:max-h-[max(0px,calc(100dvh-12rem-var(--sab,0px)))] sidebar:flex-row sm:rounded-2xl">
              <nav aria-label="Select season" className="flex w-full shrink-0 flex-row gap-0.5 overflow-x-auto overscroll-contain border-b border-white/10 bg-[#111319]/80 p-1 touch-pan-x sidebar:w-24 sidebar:flex-col sidebar:gap-1 sidebar:overflow-x-hidden sidebar:overflow-y-auto sidebar:border-b-0 sidebar:border-r sidebar:p-2 sidebar:touch-pan-y">
                {pickerSeasons.map(season => (
                  <button
                    key={season}
                    type="button"
                    onClick={() => setSelectedPickerSeason(season)}
                    aria-pressed={selectedPickerSeason === season}
                    className={`whitespace-nowrap rounded-lg px-1.5 py-1.5 text-[10px] font-semibold transition-colors min-[380px]:px-2 min-[380px]:text-[11px] sm:py-2 sm:text-xs ${
                      selectedPickerSeason === season
                        ? 'bg-rose-500/20 text-rose-300'
                        : 'text-gray-400 hover:bg-white/[0.06] hover:text-white'
                    }`}
                  >
                    Season {season}
                  </button>
                ))}
              </nav>

              <div className="min-h-0 min-w-0 flex flex-1 flex-row items-stretch gap-1 overflow-x-auto overflow-y-hidden overscroll-contain p-1.5 touch-pan-x min-[380px]:p-2 sidebar:flex-col sidebar:space-y-1 sidebar:overflow-x-hidden sidebar:overflow-y-auto sidebar:touch-pan-y sm:p-3">
                {allLocalFiles
                  .filter(file => file.exists && file.season === selectedPickerSeason && file.episode !== undefined)
                  .sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0))
                  .map(file => {
                  const season = file.season ?? 0;
                  const episode = file.episode ?? 0;
                  const details = getEpisodeDetails(season, episode);
                  const isCurrentEpisode = season === seasonNumber && episode === episodeNumber;

                  return (
                    <button
                      key={file.id}
                      type="button"
                      onClick={() => {
                        onEpisodeChange?.(file, season, episode, getEpisodeTitle(file, season, episode));
                        setIsEpisodePickerOpen(false);
                      }}
                      className={`flex min-w-0 flex-[0_0_calc(33.333%_-_0.167rem)] flex-col gap-1 rounded-lg p-1 text-left transition-colors sidebar:w-full sidebar:flex-none sidebar:flex-row sidebar:gap-3 sidebar:rounded-xl sidebar:p-2 ${
                        isCurrentEpisode ? 'bg-white/10' : 'hover:bg-white/[0.07]'
                      }`}
                    >
                      <span className="group/image relative h-20 w-full shrink-0 overflow-hidden rounded-md bg-black/40 sidebar:h-20 sidebar:w-32 sidebar:rounded-lg">
                        {(details?.still_path || media.backdrop || media.poster) && (
                          <img
                            src={details?.still_path || media.backdrop || media.poster}
                            alt=""
                            className="h-full w-full object-cover transition-transform duration-200 group-hover/image:scale-105"
                          />
                        )}
                        <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover/image:bg-black/45 group-focus-visible/image:bg-black/45">
                          <Play className="h-5 w-5 scale-75 fill-current text-white opacity-0 drop-shadow transition-all group-hover/image:scale-100 group-hover/image:opacity-100 group-focus-visible/image:scale-100 group-focus-visible/image:opacity-100" />
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[10px] font-semibold text-rose-300 sidebar:text-xs">
                          S{String(season).padStart(2, '0')}E{String(episode).padStart(2, '0')}
                        </span>
                        <span className="block truncate text-[10px] font-bold text-white sidebar:mt-1 sidebar:text-sm">
                          {getEpisodeTitle(file, season, episode)}
                        </span>
                        <span className="mt-0.5 line-clamp-3 text-[9px] leading-tight text-gray-300 sidebar:mt-1 sidebar:line-clamp-2 sidebar:text-xs sidebar:leading-relaxed">
                          {details?.overview || 'Episode description unavailable.'}
                        </span>
                      </span>
                    </button>
                  );
                })}
                {allLocalFiles.filter(file => file.exists && file.season === selectedPickerSeason && file.episode !== undefined).length === 0 && (
                  <p className="p-4 text-center text-xs text-gray-400">No available episodes in this season.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={handleExitPlayer}
        title="Back to Library"
        className={`mdv-btn mdv-btn-glass absolute left-4 top-[calc(1rem+var(--sat,0px))] z-30 h-10 cursor-pointer group flex items-center gap-2 w-10 hover:w-36 transition-[width,opacity] duration-300 ease-in-out overflow-hidden whitespace-nowrap px-0 hover:px-2 hover:backdrop-blur-md ${
          showControls || !isPlaying ? 'opacity-100' : 'pointer-events-none opacity-0'
        } ${backButtonLeftOffset}`}
      >
        <ArrowLeft className="mdv-icon-md shrink-0 transition-[margin] duration-300 ease-in-out" />
        <span className="opacity-0 transition-opacity duration-200 delay-100 group-hover:opacity-100">
          Back to Details
        </span>
      </button>

      {/* Bottom Header Overlay */}
      <div
      // bg-gradient-to-b from-black/90 via-black/50 to-transparent
        className={`absolute bottom-20 right-0 
           
          p-6 flex items-center justify-between transition-opacity duration-300 z-10 
          
          ${showControls || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'}
        max-sidebar:left-0 max-sidebar:bottom-35 sidebar: ${controlsLeftOffset} sidebar:bottom-20
        `}
      >
      <div className="relative isolate flex flex-col space-y-1 text-white truncate max-w-2xl px-4 py-3 -ml-3
  before:content-[''] before:absolute before:inset-0 before:-z-10
  before:rounded-2xl before:bg-white/[0.08] before:backdrop-blur-xl
  before:[mask-image:linear-gradient(to_right,black_0%,black_55%,transparent_100%)]">
  <h1 className="text-3xl lg:text-4xl xl:text-5xl font-bold truncate drop-shadow-md">
    {headerTitle}
  </h1>
  <h5 className="text-sm lg:text-base font-bold opacity-90">
    {subHeader}
  </h5>
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
            S{String(nextEpInfo.season).padStart(2, '0')}E{String(nextEpInfo.episode).padStart(2, '0')} - {getEpisodeTitle(nextEpInfo.file, nextEpInfo.season, nextEpInfo.episode)}
          </p>

          <div className="flex items-center space-x-2 pt-1">
            <button
              onClick={() => {
                if (countdownIntervalRef.current) clearTimeout(countdownIntervalRef.current);
                setShowNextCountdown(false);
                setCountdownCancelled(true);
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
                  onEpisodeChange(
                    nextEpInfo.file,
                    nextEpInfo.season,
                    nextEpInfo.episode,
                    getEpisodeTitle(nextEpInfo.file, nextEpInfo.season, nextEpInfo.episode)
                  );
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
      className={`absolute bottom-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-6 space-y-3 transition-opacity duration-300 z-10 ${
        showControls || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
      } max-sidebar:left-0 max-sidebar:bottom-15 sidebar: ${controlsLeftOffset} sidebar:bottom-0`}
>
        {/* Seekbar Progress Slider */}
        <div className="relative group flex items-center">
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={currentTime}
            onChange={handleSeek}
            style={{
                  background: `linear-gradient(to right, #f43f5e 0%, #f43f5e ${(currentTime/ duration) * 100 }%, 
                  rgba(255, 255, 255, 0.3) ${((currentTime/ duration)* 100)}%, rgba(255, 255, 255, 0.3) 100%)`
                }}
            className="w-full h-1.5 bg-white/20 hover:h-2.5 rounded-lg appearance-none cursor-pointer accent-rose-500 transition-all"
          />
        </div>

        {/* Controls Row */}
        <div className="flex items-center justify-between text-white">
          <div className="flex items-center space-x-4">
            {/* Play/Pause */}
            <button
              onClick={togglePlay}
              className="group p-2 text-white cursor-pointer"
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            >
              {isPlaying
                ? <Pause className="w-6 h-6 transition-transform group-hover:scale-110 group-focus-visible:scale-110" />
                : <Play className="w-6 h-6 fill-current transition-transform group-hover:scale-110 group-focus-visible:scale-110" />}
            </button>

            {/* Restart From Beginning */}
            <button
              onClick={() => {
                if (videoRef.current) {
                  videoRef.current.currentTime = 0;
                  setCurrentTime(0);
                }
              }}
              className="group p-2 text-gray-300 hover:text-white cursor-pointer"
              title="Restart from Beginning"
            >
              <RotateCcw className="w-5 h-5 transition-transform group-hover:scale-110 group-focus-visible:scale-110" />
            </button>

            {/* Next Episode Button if available */}
            {media.type === 'TV Series' && nextEpInfo && (
              <button
                onClick={() => {
                  if (onEpisodeChange) {
                    onEpisodeChange(
                      nextEpInfo.file,
                      nextEpInfo.season,
                      nextEpInfo.episode,
                      getEpisodeTitle(nextEpInfo.file, nextEpInfo.season, nextEpInfo.episode)
                    );
                  }
                }}
                className="group p-2 text-gray-300 hover:text-white cursor-pointer"
                title={`Next Episode (S${String(nextEpInfo.season).padStart(2, '0')}E${String(nextEpInfo.episode).padStart(2, '0')})`}
              >
                <SkipForward className="w-5 h-5 transition-transform group-hover:scale-110 group-focus-visible:scale-110" />
              </button>
            )}

            {/* Volume */}
            <div className="flex items-center space-x-2 group">
              <button
                onClick={toggleMute}
                className="group p-1.5 text-white cursor-pointer"
                title={isMuted || volume === 0 ? 'Unmute' : 'Mute'}
              >
                {isMuted || volume === 0
                  ? <VolumeX className="w-5 h-5 transition-transform group-hover:scale-110 group-focus-visible:scale-110" />
                  : <Volume2 className="w-5 h-5 transition-transform group-hover:scale-110 group-focus-visible:scale-110" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                style={{
                  background: `linear-gradient(to right, #f43f5e 0%, #f43f5e ${(isMuted ? 0 : volume) * 100}%, 
                  rgba(255, 255, 255, 0.3) ${(isMuted ? 0 : volume) * 100}%, rgba(255, 255, 255, 0.3) 100%)`
                }}
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

          <div className="flex items-center space-x-1.5 min-[1090px]:space-x-3">
            {/* Playback Speed Selector */}
            <div
              className="group relative flex h-9 w-9 shrink-0 items-center justify-center text-white min-[1090px]:h-auto min-[1090px]:w-auto min-[1090px]:space-x-1 min-[1090px]:text-xs"
              title={`Playback speed: ${playbackSpeed}x`}
            >
              <Sliders className="w-4 h-4 text-gray-400 transition-transform group-hover:scale-110 group-hover:text-white group-focus-within:scale-110 group-focus-within:text-white" />
              <select
                value={playbackSpeed}
                onChange={(e) => handleSpeedChange(Number(e.target.value))}
                aria-label="Playback speed"
                className="bg-black/60 border border-white/20 text-white text-xs rounded-lg px-2 py-1 backdrop-blur-md cursor-pointer hover:bg-black/80 max-[1089px]:absolute max-[1089px]:inset-0 max-[1089px]:h-full max-[1089px]:w-full max-[1089px]:opacity-0 max-[1089px]:cursor-pointer"
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
            <div
              className="group relative flex h-9 w-9 shrink-0 items-center justify-center text-white min-[1090px]:h-auto min-[1090px]:w-auto min-[1090px]:space-x-1 min-[1090px]:text-xs"
              title={subtitleError || 'Subtitle track'}
            >
              <Subtitles className="w-4 h-4 text-rose-400 transition-transform group-hover:scale-110 group-hover:brightness-125 group-focus-within:scale-110 group-focus-within:brightness-125" />
              <select
                value={selectedSubtitleId}
                onChange={(e) => setSelectedSubtitleId(e.target.value)}
                aria-label="Subtitle track"
                disabled={mkvParsing || subtitleTracks.length + embeddedSubtitleTracks.length === 0}
                className="bg-black/60 border border-white/20 text-white text-xs rounded-lg px-2 py-1 backdrop-blur-md cursor-pointer hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-60 max-[1089px]:absolute max-[1089px]:inset-0 max-[1089px]:h-full max-[1089px]:w-full max-[1089px]:opacity-0 max-[1089px]:cursor-pointer"
              >
                {subtitleTracks.length + embeddedSubtitleTracks.length === 0 ? (
                  <option value="off" className="bg-[#14161f]">
                    {mkvParsing ? 'Reading embedded subtitles…' : subtitleError ? 'Subtitle load failed' : loading ? 'Searching subtitles…' : 'No subtitles available'}
                  </option>
                ) : (
                  <>
                    <option value="off" className="bg-[#14161f]">Subtitles Off</option>
                    {subtitleTracks.map(sub => (
                      <option key={sub.id} value={`sidecar:${sub.id}`} className="bg-[#14161f]">
                        {sub.label}{sub.embedded ? ' (Embedded)' : ''}
                      </option>
                    ))}
                    {embeddedSubtitleTracks.map(track => (
                      <option key={track.id} value={track.id} className="bg-[#14161f]">
                        {track.label} (Embedded)
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>

            {/* Audio Track Selector */}
            <div
              className="group relative flex h-9 w-9 shrink-0 items-center justify-center text-white min-[1090px]:h-auto min-[1090px]:w-auto min-[1090px]:space-x-1 min-[1090px]:text-xs"
              title={audioTrackSupport === false ? 'Audio track switching is not supported by this video runtime.' : 'Audio track'}
            >
              <AudioLines className="w-4 h-4 text-rose-400 transition-transform group-hover:scale-110 group-hover:brightness-125 group-focus-within:scale-110 group-focus-within:brightness-125" />
              <select
                value={audioTracks.length ? selectedAudioTrackId : ''}
                onChange={(e) => setSelectedAudioTrackId(e.target.value)}
                aria-label="Audio track"
                disabled={audioTracks.length < 2}
                className="bg-black/60 border border-white/20 text-white text-xs rounded-lg px-2 py-1 backdrop-blur-md cursor-pointer hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-60 max-[1089px]:absolute max-[1089px]:inset-0 max-[1089px]:h-full max-[1089px]:w-full max-[1089px]:opacity-0 max-[1089px]:cursor-pointer"
              >
                {audioTracks.length === 0 ? (
                  <option value="" className="bg-[#14161f]">
                    {audioTrackSupport === false
                      ? 'Audio switching unavailable'
                      : audioTrackSupport === null
                        ? 'Detecting audio…'
                        : 'No alternate audio'}
                  </option>
                ) : (
                  audioTracks.map(track => (
                    <option key={track.id} value={track.id} className="bg-[#14161f]">
                      {track.label}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Fullscreen Toggle */}
            <button
              onClick={toggleFullscreen}
              className="group p-2 text-white cursor-pointer"
              title="Fullscreen (F)"
            >
              {isFullscreen
                ? <Minimize className="w-5 h-5 transition-transform group-hover:scale-110 group-focus-visible:scale-110" />
                : <Maximize className="w-5 h-5 transition-transform group-hover:scale-110 group-focus-visible:scale-110" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
