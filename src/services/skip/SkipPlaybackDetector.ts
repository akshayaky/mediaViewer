import { SkipSegmentBounds } from '../../types/media';

export type SkippableSegmentType = 'intro' | 'recap';

export interface ActiveSkipSegment {
  type: SkippableSegmentType;
  label: 'Skip Intro' | 'Skip Recap';
  targetTime: number;
  start: number;
  end: number;
}

export interface SkipDetectorOptions {
  intro?: SkipSegmentBounds | null;
  recap?: SkipSegmentBounds | null;
  autoSkipIntro?: boolean;
  autoSkipRecap?: boolean;
}

export interface SkipEvaluationResult {
  activeSegment: ActiveSkipSegment | null;
  autoSeekTarget: number | null;
  autoSkipType: SkippableSegmentType | null;
}

export class SkipPlaybackDetector {
  private intro: SkipSegmentBounds | null = null;
  private recap: SkipSegmentBounds | null = null;
  private autoSkipIntro = false;
  private autoSkipRecap = false;

  private hasAutoSkippedIntro = false;
  private hasAutoSkippedRecap = false;
  private userSkippedIntro = false;
  private userSkippedRecap = false;
  private userSoughtIntoIntro = false;
  private userSoughtIntoRecap = false;

  constructor(options: SkipDetectorOptions = {}) {
    this.updateConfig(options);
  }

  public updateConfig(options: SkipDetectorOptions): void {
    if (options.intro !== undefined) this.intro = options.intro;
    if (options.recap !== undefined) this.recap = options.recap;
    if (options.autoSkipIntro !== undefined) this.autoSkipIntro = options.autoSkipIntro;
    if (options.autoSkipRecap !== undefined) this.autoSkipRecap = options.autoSkipRecap;
  }

  public setSegments(intro: SkipSegmentBounds | null, recap: SkipSegmentBounds | null): void {
    this.intro = intro;
    this.recap = recap;
  }

  public setAutoSkipSettings(autoSkipIntro: boolean, autoSkipRecap: boolean): void {
    this.autoSkipIntro = autoSkipIntro;
    this.autoSkipRecap = autoSkipRecap;
  }

  public notifySeek(targetTime: number): void {
    if (this.intro && targetTime >= this.intro.start && targetTime < this.intro.end) {
      this.userSoughtIntoIntro = true;
      this.hasAutoSkippedIntro = true;
      this.userSkippedIntro = false;
    } else if (this.intro && targetTime < this.intro.start) {
      this.hasAutoSkippedIntro = false;
      this.userSkippedIntro = false;
      this.userSoughtIntoIntro = false;
    }

    if (this.recap && targetTime >= this.recap.start && targetTime < this.recap.end) {
      this.userSoughtIntoRecap = true;
      this.hasAutoSkippedRecap = true;
      this.userSkippedRecap = false;
    } else if (this.recap && targetTime < this.recap.start) {
      this.hasAutoSkippedRecap = false;
      this.userSkippedRecap = false;
      this.userSoughtIntoRecap = false;
    }
  }

  public evaluate(currentTime: number): SkipEvaluationResult {
    if (this.intro) {
      const inIntro = currentTime >= this.intro.start && currentTime < this.intro.end;

      if (!inIntro) {
        if (currentTime < this.intro.start) {
          this.hasAutoSkippedIntro = false;
          this.userSkippedIntro = false;
          this.userSoughtIntoIntro = false;
        } else {
          this.userSoughtIntoIntro = false;
        }
      } else {
        if (this.autoSkipIntro && !this.hasAutoSkippedIntro && !this.userSoughtIntoIntro && !this.userSkippedIntro) {
          this.hasAutoSkippedIntro = true;
          return {
            activeSegment: null,
            autoSeekTarget: this.intro.end,
            autoSkipType: 'intro'
          };
        }

        if ((this.hasAutoSkippedIntro && !this.userSoughtIntoIntro) || this.userSkippedIntro) {
          return { activeSegment: null, autoSeekTarget: null, autoSkipType: null };
        }

        return {
          activeSegment: {
            type: 'intro',
            label: 'Skip Intro',
            targetTime: this.intro.end,
            start: this.intro.start,
            end: this.intro.end
          },
          autoSeekTarget: null,
          autoSkipType: null
        };
      }
    }

    if (this.recap) {
      const inRecap = currentTime >= this.recap.start && currentTime < this.recap.end;

      if (!inRecap) {
        if (currentTime < this.recap.start) {
          this.hasAutoSkippedRecap = false;
          this.userSkippedRecap = false;
          this.userSoughtIntoRecap = false;
        } else {
          this.userSoughtIntoRecap = false;
        }
      } else {
        if (this.autoSkipRecap && !this.hasAutoSkippedRecap && !this.userSoughtIntoRecap && !this.userSkippedRecap) {
          this.hasAutoSkippedRecap = true;
          return {
            activeSegment: null,
            autoSeekTarget: this.recap.end,
            autoSkipType: 'recap'
          };
        }

        if ((this.hasAutoSkippedRecap && !this.userSoughtIntoRecap) || this.userSkippedRecap) {
          return { activeSegment: null, autoSeekTarget: null, autoSkipType: null };
        }

        return {
          activeSegment: {
            type: 'recap',
            label: 'Skip Recap',
            targetTime: this.recap.end,
            start: this.recap.start,
            end: this.recap.end
          },
          autoSeekTarget: null,
          autoSkipType: null
        };
      }
    }

    return { activeSegment: null, autoSeekTarget: null, autoSkipType: null };
  }

  public handleManualSkip(type: SkippableSegmentType): number | null {
    if (type === 'intro' && this.intro) {
      this.userSkippedIntro = true;
      this.hasAutoSkippedIntro = true;
      this.userSoughtIntoIntro = false;
      return this.intro.end;
    }
    if (type === 'recap' && this.recap) {
      this.userSkippedRecap = true;
      this.hasAutoSkippedRecap = true;
      this.userSoughtIntoRecap = false;
      return this.recap.end;
    }
    return null;
  }

  public reset(): void {
    this.hasAutoSkippedIntro = false;
    this.hasAutoSkippedRecap = false;
    this.userSkippedIntro = false;
    this.userSkippedRecap = false;
    this.userSoughtIntoIntro = false;
    this.userSoughtIntoRecap = false;
  }
}
