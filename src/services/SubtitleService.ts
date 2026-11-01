export interface SubtitleTrack {
  id: string;
  label: string;
  language: string;
  url: string;
  embedded?: boolean;
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
    if (!videoPath || typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
      return [];
    }

    const { invoke } = await import('@tauri-apps/api/core');
    const subtitlePaths = await invoke<string[]>('list_subtitle_files', { videoPath });
    const videoName = videoPath.split(/[\\/]/).pop() || videoPath;
    const videoStem = videoName.replace(/\.[^.]+$/, '');
    const tracks: SubtitleTrack[] = [];

    for (const path of subtitlePaths) {
      const subtitleUrl = await invoke<string>('get_subtitle_url', { filePath: path });
      const subtitleName = path.split(/[\\/]/).pop() || path;
      const extension = subtitleName.split('.').pop()?.toLowerCase();
      const subtitleStem = subtitleName.replace(/\.[^.]+$/, '');
      const suffix = subtitleStem.toLowerCase().startsWith(`${videoStem.toLowerCase()}.`)
        ? subtitleStem.slice(videoStem.length + 1)
        : '';
      const languageParts = suffix.split('.').filter(Boolean);
      const languageCode = languageParts.find(part => /^(en|eng|es|spa|fr|fra|de|deu|it|ita|pt|por|ja|jpn|ko|kor|zh|zho|ru|rus)$/i.test(part));
      const languageNames: Record<string, string> = {
        en: 'English', eng: 'English',
        es: 'Spanish', spa: 'Spanish',
        fr: 'French', fra: 'French',
        de: 'German', deu: 'German',
        it: 'Italian', ita: 'Italian',
        pt: 'Portuguese', por: 'Portuguese',
        ja: 'Japanese', jpn: 'Japanese',
        ko: 'Korean', kor: 'Korean',
        zh: 'Chinese', zho: 'Chinese',
        ru: 'Russian', rus: 'Russian'
      };
      const language = languageCode?.toLowerCase() || 'und';
      const labelParts = [
        languageCode ? languageNames[language] || languageCode.toUpperCase() : suffix || 'Default',
        ...languageParts.filter(part => part !== languageCode).map(part =>
          part.charAt(0).toUpperCase() + part.slice(1)
        )
      ];

      let url = subtitleUrl;
      if (extension === 'srt') {
        const response = await fetch(subtitleUrl);
        if (!response.ok) {
          throw new Error(`Could not load subtitle file "${subtitleName}" (${response.status}).`);
        }
        const vtt = this.convertSrtToVtt(await response.text());
        url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
      }

      tracks.push({
        id: path,
        label: `${labelParts.join(' · ')} (${extension?.toUpperCase()})`,
        language,
        url
      });
    }

    return tracks;
  }
}

export const subtitleService = new SubtitleService();
