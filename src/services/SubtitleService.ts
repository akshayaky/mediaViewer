export interface SubtitleTrack {
  id: string;
  label: string;
  language: string;
  url: string;
}

export class SubtitleService {
  /** Converts SRT format subtitle text to WebVTT format */
  public convertSrtToVtt(srtText: string): string {
    let vtt = 'WEBVTT\n\n';

    // Normalize line endings
    const normalized = srtText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Replace comma in timestamps with period
    // e.g. 00:01:20,000 --> 00:01:23,400 -> 00:01:20.000 --> 00:01:23.400
    const converted = normalized.replace(
      /(\d{2}:\d{2}:\d{2}),(\d{3})/g,
      '$1.$2'
    );

    vtt += converted;
    return vtt;
  }

  /**
   * Attempts to discover sidecar SRT files for a given video file path in Tauri or browser.
   */
  public async discoverSubtitlesForVideo(videoPath: string): Promise<SubtitleTrack[]> {
    const tracks: SubtitleTrack[] = [];
    if (!videoPath) return tracks;

    const basePath = videoPath.substring(0, videoPath.lastIndexOf('.'));

    const candidates = [
      { path: `${basePath}.srt`, label: 'English (Default)', lang: 'en' },
      { path: `${basePath}.en.srt`, label: 'English', lang: 'en' },
      { path: `${basePath}.eng.srt`, label: 'English', lang: 'en' },
      { path: `${basePath}.vtt`, label: 'English (VTT)', lang: 'en' },
    ];

    for (const item of candidates) {
      try {
        if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
          const { invoke } = await import('@tauri-apps/api/core');
          const subUrl = await invoke<string>('get_subtitle_url', { filePath: item.path });

          // Fetch the subtitle content to convert if it's SRT
          if (item.path.endsWith('.srt')) {
            const resp = await fetch(subUrl);
            if (resp.ok) {
              const text = await resp.text();
              const vttText = this.convertSrtToVtt(text);
              const blob = new Blob([vttText], { type: 'text/vtt' });
              const blobUrl = URL.createObjectURL(blob);
              tracks.push({
                id: item.path,
                label: item.label,
                language: item.lang,
                url: blobUrl
              });
            }
          } else if (item.path.endsWith('.vtt')) {
            tracks.push({
              id: item.path,
              label: item.label,
              language: item.lang,
              url: subUrl
            });
          }
        }
      } catch {
        // Candidate file does not exist or fetch failed
      }
    }

    return tracks;
  }
}

export const subtitleService = new SubtitleService();
