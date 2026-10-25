import { describe, it, expect, beforeEach } from 'vitest';
import { subtitleService } from '../services/SubtitleService';
import { dbService } from '../services/DatabaseService';
import { PlaybackProgress } from '../types/media';

describe('Playback Progress & Subtitle Services', () => {
  it('converts SRT format subtitles to WebVTT format', () => {
    const srt = `1\n00:00:01,000 --> 00:00:04,500\nHello World\n\n2\n00:00:05,200 --> 00:00:08,100\nSecond line`;
    const vtt = subtitleService.convertSrtToVtt(srt);

    expect(vtt).toContain('WEBVTT');
    expect(vtt).toContain('00:00:01.000 --> 00:00:04.500');
    expect(vtt).toContain('Hello World');
    expect(vtt).not.toContain('00:00:01,000');
  });

  it('calculates completion correctly when position exceeds 90%', async () => {
    const prog: PlaybackProgress = {
      id: 'test_prog_1',
      media_id: 'media_test_1',
      season: 1,
      episode: 3,
      position_seconds: 920,
      duration_seconds: 1000,
      updated_at: new Date().toISOString(),
      is_completed: false
    };

    await dbService.savePlaybackProgress(prog);
    const fetched = await dbService.getPlaybackProgress('media_test_1', 1, 3);

    expect(fetched).not.toBeNull();
    expect(fetched?.is_completed).toBe(true);
    expect(fetched?.position_seconds).toBe(920);
  });

  it('preserves incomplete status when position is under 90%', async () => {
    const prog: PlaybackProgress = {
      id: 'test_prog_2',
      media_id: 'media_test_2',
      season: 0,
      episode: 0,
      position_seconds: 400,
      duration_seconds: 1000,
      updated_at: new Date().toISOString(),
      is_completed: false
    };

    await dbService.savePlaybackProgress(prog);
    const fetched = await dbService.getPlaybackProgress('media_test_2', 0, 0);

    expect(fetched).not.toBeNull();
    expect(fetched?.is_completed).toBe(false);
    expect(fetched?.position_seconds).toBe(400);
  });
});
