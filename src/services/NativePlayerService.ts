export interface NativeAudioTrack {
  id: string;
  title: string;
  language?: string;
  codec?: string;
  channels?: string;
  channelCount?: number;
  isDefault: boolean;
  isSelected: boolean;
  isExternal: boolean;
}

export interface NativeSubtitleTrack {
  id: string;
  title: string;
  language?: string;
  codec?: string;
  isDefault: boolean;
  isSelected: boolean;
  isExternal: boolean;
}

export interface NativePlayerState {
  isReady: boolean;
  isFrameReady: boolean;
  isPlaying: boolean;
  isPaused: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  playbackRate: number;
  audioTracks: NativeAudioTrack[];
  selectedAudioTrackId: string | null;
  subtitleTracks: NativeSubtitleTrack[];
  selectedSubtitleTrackId: string | null;
  activeFile: string | null;
  error: string | null;
}

export const INITIAL_NATIVE_PLAYER_STATE: NativePlayerState = {
  isReady: false,
  isFrameReady: false,
  isPlaying: false,
  isPaused: true,
  isBuffering: false,
  currentTime: 0,
  duration: 0,
  volume: 100,
  isMuted: false,
  playbackRate: 1,
  audioTracks: [],
  selectedAudioTrackId: null,
  subtitleTracks: [],
  selectedSubtitleTrackId: null,
  activeFile: null,
  error: null,
};

type StateChangeCallback = (state: NativePlayerState) => void;
type EndedCallback = () => void;

class NativePlayerService {
  private state: NativePlayerState = { ...INITIAL_NATIVE_PLAYER_STATE };
  private stateListeners = new Set<StateChangeCallback>();
  private endedListeners = new Set<EndedCallback>();
  private unlistenState?: () => void;
  private unlistenEnded?: () => void;
  private isInitialized = false;
  private pendingProperties = new Map<string, string>();

  public get initialized(): boolean {
    return this.isInitialized;
  }

  private isTauriAvailable(): boolean {
    return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
  }

  public async init(): Promise<boolean> {
    if (!this.isTauriAvailable()) {
      console.warn('[NativePlayerService] Running outside of Tauri; native player disabled');
      return false;
    }

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const { listen } = await import('@tauri-apps/api/event');

      await invoke('native_player_init');
      this.isInitialized = true;

      // Flush any properties set prior to initialization (e.g. video-align-y, panscan)
      for (const [name, value] of this.pendingProperties.entries()) {
        try {
          await invoke('native_player_set_property', { name, value });
        } catch (err) {
          console.warn(`[NativePlayerService] Failed to flush property ${name}=${value}:`, err);
        }
      }

      // Clean up previous event listeners if any
      this.cleanupListeners();

      // Listen for state changes emitted from Rust background thread
      this.unlistenState = await listen<NativePlayerState>('native-player:state', (event) => {
        this.state = { ...event.payload };
        this.notifyStateListeners();
      });

      this.unlistenEnded = await listen('native-player:ended', () => {
        for (const listener of this.endedListeners) {
          try {
            listener();
          } catch (e) {
            console.error('[NativePlayerService] Error in ended listener:', e);
          }
        }
      });

      // Fetch initial state
      const initial = await invoke<NativePlayerState>('native_player_get_state');
      this.state = { ...initial };
      this.notifyStateListeners();

      return true;
    } catch (err) {
      console.error('[NativePlayerService] Failed to initialize native player:', err);
      this.state.error = err instanceof Error ? err.message : String(err);
      this.notifyStateListeners();
      return false;
    }
  }

  public async loadFile(path: string, startPosition?: number): Promise<void> {
    if (!this.isTauriAvailable()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('native_player_load_file', { path, startPosition: startPosition ?? 0 });
    // Re-apply properties to the newly loaded media stream
    for (const [name, value] of this.pendingProperties.entries()) {
      try {
        await invoke('native_player_set_property', { name, value });
      } catch (err) {
        console.warn(`[NativePlayerService] Failed to set property ${name}=${value} on load:`, err);
      }
    }
  }

  public async play(): Promise<void> {
    if (!this.isTauriAvailable()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('native_player_play');
  }

  public async pause(): Promise<void> {
    if (!this.isTauriAvailable()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('native_player_pause');
  }

  public async togglePause(): Promise<void> {
    if (!this.isTauriAvailable()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('native_player_toggle_pause');
  }

  public async seek(position: number, relative: boolean = false): Promise<void> {
    if (!this.isTauriAvailable()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('native_player_seek', { position, relative });
  }

  public async setVolume(volume: number): Promise<void> {
    if (!this.isTauriAvailable()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('native_player_set_volume', { volume });
  }

  public async setMute(muted: boolean): Promise<void> {
    if (!this.isTauriAvailable()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('native_player_set_mute', { muted });
  }

  public async setSpeed(speed: number): Promise<void> {
    if (!this.isTauriAvailable()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('native_player_set_speed', { speed });
  }

  public async setAudioTrack(trackId: string): Promise<void> {
    if (!this.isTauriAvailable()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('native_player_set_audio_track', { trackId });
  }

  public async setSubtitleTrack(trackId: string): Promise<void> {
    if (!this.isTauriAvailable()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('native_player_set_subtitle_track', { trackId });
  }

  public async addSubtitleFile(path: string): Promise<void> {
    if (!this.isTauriAvailable()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('native_player_add_subtitle_file', { path });
  }

  public async setProperty(name: string, value: string): Promise<void> {
    if (!this.isTauriAvailable()) return;
    this.pendingProperties.set(name, value);
    if (!this.isInitialized) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('native_player_set_property', { name, value });
  }

  public async getState(): Promise<NativePlayerState> {
    if (!this.isTauriAvailable()) return this.state;
    const { invoke } = await import('@tauri-apps/api/core');
    this.state = await invoke<NativePlayerState>('native_player_get_state');
    return this.state;
  }

  public async stop(): Promise<void> {
    if (!this.isTauriAvailable()) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('native_player_stop');
    } catch (e) {
      console.warn('[NativePlayerService] Error stopping player:', e);
    }
  }

  public async destroy(): Promise<void> {
    if (!this.isTauriAvailable()) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('native_player_destroy');
    } catch (e) {
      console.warn('[NativePlayerService] Error destroying player:', e);
    } finally {
      this.cleanupListeners();
      this.isInitialized = false;
      this.pendingProperties.clear();
      this.state = { ...INITIAL_NATIVE_PLAYER_STATE };
    }
  }

  public onStateChange(callback: StateChangeCallback): () => void {
    this.stateListeners.add(callback);
    callback(this.state);
    return () => {
      this.stateListeners.delete(callback);
    };
  }

  public onEnded(callback: EndedCallback): () => void {
    this.endedListeners.add(callback);
    return () => {
      this.endedListeners.delete(callback);
    };
  }

  private notifyStateListeners(): void {
    for (const listener of this.stateListeners) {
      try {
        listener(this.state);
      } catch (e) {
        console.error('[NativePlayerService] Error in state listener:', e);
      }
    }
  }

  private cleanupListeners(): void {
    if (this.unlistenState) {
      this.unlistenState();
      this.unlistenState = undefined;
    }
    if (this.unlistenEnded) {
      this.unlistenEnded();
      this.unlistenEnded = undefined;
    }
  }
}

export const nativePlayerService = new NativePlayerService();
