import { describe, it, expect } from 'vitest';
import { MediaHistory, MediaState } from '../types/media';

/**
 * Pure state calculator matching DatabaseService.getMediaState logic
 */
function calculateMediaState(media_id: string, histories: MediaHistory[]): MediaState {
  if (!histories.length) {
    return {
      media_id,
      current_status: 'Planned',
      total_watch_play_count: 0,
      rewatch_count: 0,
      abandoned_count: 0,
      currently_watching_playing: false
    };
  }

  const sorted = [...histories].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const latest = sorted[sorted.length - 1];

  let totalCount = 0;
  let rewatchCount = 0;
  let abandonedCount = 0;
  let firstDate: string | undefined = undefined;
  let recentCompletion: string | undefined = undefined;

  for (const h of sorted) {
    const date = h.completed_at || h.started_at || h.created_at;
    if (!firstDate || (date && new Date(date).getTime() < new Date(firstDate).getTime())) {
      firstDate = date;
    }

    if (h.status === 'Finished') {
      totalCount++;
      if (totalCount > 1 || (h.context && h.context.toLowerCase().includes('rewatch'))) {
        rewatchCount++;
      }
      if (h.completed_at) {
        if (!recentCompletion || new Date(h.completed_at).getTime() > new Date(recentCompletion).getTime()) {
          recentCompletion = h.completed_at;
        }
      }
    } else if (h.status === 'Abandoned') {
      abandonedCount++;
    }
  }

  const lastWatchedPlayed = latest.completed_at || latest.started_at || latest.created_at;

  return {
    media_id,
    current_status: latest.status,
    last_watched_played: lastWatchedPlayed,
    total_watch_play_count: totalCount,
    rewatch_count: rewatchCount,
    abandoned_count: abandonedCount,
    currently_watching_playing: latest.status === 'Currently',
    first_watched_played: firstDate,
    most_recent_completion: recentCompletion
  };
}

describe('calculateMediaState', () => {
  it('returns Planned for empty history', () => {
    const state = calculateMediaState('m1', []);
    expect(state.current_status).toBe('Planned');
    expect(state.total_watch_play_count).toBe(0);
    expect(state.currently_watching_playing).toBe(false);
  });

  it('calculates total watches and rewatch count', () => {
    const histories: MediaHistory[] = [
      {
        id: 'h1',
        media_id: 'm1',
        status: 'Finished',
        completed_at: '2024-01-10',
        source: 'Notion',
        created_at: '2024-01-10T10:00:00Z'
      },
      {
        id: 'h2',
        media_id: 'm1',
        status: 'Finished',
        completed_at: '2024-05-20',
        context: '2+ Rewatch',
        source: 'Notion',
        created_at: '2024-05-20T10:00:00Z'
      }
    ];

    const state = calculateMediaState('m1', histories);
    expect(state.total_watch_play_count).toBe(2);
    expect(state.rewatch_count).toBe(1);
    expect(state.current_status).toBe('Finished');
    expect(state.most_recent_completion).toBe('2024-05-20');
  });

  it('identifies currently active sessions', () => {
    const histories: MediaHistory[] = [
      {
        id: 'h1',
        media_id: 'm1',
        status: 'Currently',
        started_at: '2025-02-01',
        source: 'Manual',
        created_at: '2025-02-01T10:00:00Z'
      }
    ];

    const state = calculateMediaState('m1', histories);
    expect(state.current_status).toBe('Currently');
    expect(state.currently_watching_playing).toBe(true);
  });
});
