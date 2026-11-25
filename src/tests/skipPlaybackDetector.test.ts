import { describe, it, expect, beforeEach } from 'vitest';
import { SkipPlaybackDetector } from '../services/skip/SkipPlaybackDetector';

describe('SkipPlaybackDetector', () => {
  let detector: SkipPlaybackDetector;

  beforeEach(() => {
    detector = new SkipPlaybackDetector({
      intro: { start: 10, end: 45 },
      recap: { start: 60, end: 80 },
      autoSkipIntro: false,
      autoSkipRecap: false
    });
  });

  it('displays Skip Intro button when current time enters intro segment', () => {
    // Before intro
    expect(detector.evaluate(5).activeSegment).toBeNull();

    // At intro start
    const atStart = detector.evaluate(10);
    expect(atStart.activeSegment).not.toBeNull();
    expect(atStart.activeSegment?.type).toBe('intro');
    expect(atStart.activeSegment?.label).toBe('Skip Intro');
    expect(atStart.activeSegment?.targetTime).toBe(45);
    expect(atStart.autoSeekTarget).toBeNull();

    // Inside intro
    const inside = detector.evaluate(25);
    expect(inside.activeSegment?.type).toBe('intro');

    // Immediately after intro
    const after = detector.evaluate(45);
    expect(after.activeSegment).toBeNull();
  });

  it('displays Skip Recap button when current time enters recap segment', () => {
    // Before recap
    expect(detector.evaluate(55).activeSegment).toBeNull();

    // Inside recap
    const inside = detector.evaluate(70);
    expect(inside.activeSegment).not.toBeNull();
    expect(inside.activeSegment?.type).toBe('recap');
    expect(inside.activeSegment?.label).toBe('Skip Recap');
    expect(inside.activeSegment?.targetTime).toBe(80);
    expect(inside.autoSeekTarget).toBeNull();

    // After recap
    expect(detector.evaluate(80).activeSegment).toBeNull();
  });

  it('hides button immediately when manual skip is clicked', () => {
    // Enter intro
    expect(detector.evaluate(20).activeSegment).not.toBeNull();

    // User clicks skip
    const seekTarget = detector.handleManualSkip('intro');
    expect(seekTarget).toBe(45);

    // Re-evaluating inside the segment after manual skip hides button
    expect(detector.evaluate(20).activeSegment).toBeNull();
  });

  it('automatically skips intro when autoSkipIntro is enabled', () => {
    detector.setAutoSkipSettings(true, false);

    // Before intro
    expect(detector.evaluate(5).autoSeekTarget).toBeNull();

    // Enters intro -> triggers auto-seek to intro.end
    const result = detector.evaluate(10);
    expect(result.autoSeekTarget).toBe(45);
    expect(result.activeSegment).toBeNull();

    // Subsequent evaluations inside intro do not repeatedly trigger autoSeek
    const secondEval = detector.evaluate(15);
    expect(secondEval.autoSeekTarget).toBeNull();
    expect(secondEval.activeSegment).toBeNull();
  });

  it('automatically skips recap when autoSkipRecap is enabled', () => {
    detector.setAutoSkipSettings(false, true);

    // Enters recap -> triggers auto-seek to recap.end
    const result = detector.evaluate(60);
    expect(result.autoSeekTarget).toBe(80);
    expect(result.autoSkipType).toBe('recap');
    expect(result.activeSegment).toBeNull();

    // Subsequent evaluations inside recap do not repeatedly trigger autoSeek
    const secondEval = detector.evaluate(65);
    expect(secondEval.autoSeekTarget).toBeNull();
    expect(secondEval.activeSegment).toBeNull();
  });

  it('respects separate toggles for auto-intro and auto-outro', () => {
    // Intro enabled, recap disabled
    detector.setAutoSkipSettings(true, false);
    expect(detector.evaluate(15).autoSeekTarget).toBe(45);
    expect(detector.evaluate(70).autoSeekTarget).toBeNull();
    expect(detector.evaluate(70).activeSegment?.type).toBe('recap');

    // Reset detector
    detector.reset();

    // Intro disabled, recap enabled
    detector.setAutoSkipSettings(false, true);
    expect(detector.evaluate(15).autoSeekTarget).toBeNull();
    expect(detector.evaluate(15).activeSegment?.type).toBe('intro');
    expect(detector.evaluate(70).autoSeekTarget).toBe(80);
  });

  it('respects playback seeking and avoids repeatedly triggering the same auto-skip', () => {
    detector.setAutoSkipSettings(true, false);

    // Natural entry triggers auto-skip
    const firstEntry = detector.evaluate(10);
    expect(firstEntry.autoSeekTarget).toBe(45);

    // User explicitly seeks back into the intro
    detector.notifySeek(20);

    // Must NOT immediately auto-skip again!
    const afterSeek = detector.evaluate(20);
    expect(afterSeek.autoSeekTarget).toBeNull();

    // But manual skip button remains accessible
    expect(afterSeek.activeSegment?.type).toBe('intro');
  });

  it('resets skip triggers when user seeks before the intro segment', () => {
    detector.setAutoSkipSettings(true, false);

    // Auto-skip triggered once
    expect(detector.evaluate(10).autoSeekTarget).toBe(45);

    // User rewinds to the beginning of the video (0s)
    detector.notifySeek(0);
    detector.evaluate(0);

    // Playback advances to intro again -> auto-skip should trigger cleanly
    const reEntry = detector.evaluate(10);
    expect(reEntry.autoSeekTarget).toBe(45);
  });
});
