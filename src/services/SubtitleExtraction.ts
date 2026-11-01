import { Buffer } from 'buffer';
import { Decoder } from 'ts-ebml';
import type { EBMLElementDetail } from 'ts-ebml';

function ensureBufferPolyfill(): void {
  if (typeof globalThis.Buffer === 'undefined') {
    Object.assign(globalThis, { Buffer });
  }
}

export interface ExtractedMkvSubtitle {
  id: string;
  label: string;
  language: string;
  webVtt: string;
}

interface MkvTrack {
  number: number | null;
  type: number | null;
  codec: string | null;
  language: string;
  name: string;
  timestampScale: number;
  timestampOffset: number;
  defaultDuration: number | null;
}

interface SubtitleCue {
  startMs: number;
  durationMs: number | null;
  text: string;
}

interface ParsedBlock {
  trackNumber: number;
  relativeTimecode: number;
  frames: Uint8Array[];
}

interface BlockGroup {
  block: Uint8Array | null;
  duration: number | null;
}

const DECODE_CHUNK_SIZE = 4 * 1024 * 1024;
const DEFAULT_CUE_DURATION_MS = 5000;
const SUPPORTED_SUBTITLE_CODECS = new Set([
  'S_TEXT/UTF8',
  'S_TEXT/ASS',
  'S_TEXT/SSA',
  'S_ASS',
  'S_SSA'
]);

function readVint(bytes: Uint8Array, offset: number): { value: number; length: number } {
  const firstByte = bytes[offset];
  if (firstByte === undefined || firstByte === 0) {
    throw new Error('Invalid Matroska block: missing track-number VINT.');
  }

  let length = 1;
  let marker = 0x80;
  while ((firstByte & marker) === 0 && length <= 8) {
    marker >>= 1;
    length += 1;
  }
  if (length > 8 || offset + length > bytes.length) {
    throw new Error('Invalid Matroska block: truncated VINT.');
  }

  let value = firstByte & (marker - 1);
  for (let index = 1; index < length; index += 1) {
    value = value * 256 + bytes[offset + index];
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error('Invalid Matroska block: VINT exceeds the safe integer range.');
  }
  return { value, length };
}

function parseBlock(bytes: Uint8Array): ParsedBlock {
  const track = readVint(bytes, 0);
  const timecodeOffset = track.length;
  if (bytes.length < timecodeOffset + 3) {
    throw new Error('Invalid Matroska block: missing timecode or flags.');
  }

  const rawTimecode = (bytes[timecodeOffset] << 8) | bytes[timecodeOffset + 1];
  const relativeTimecode = rawTimecode >= 0x8000 ? rawTimecode - 0x10000 : rawTimecode;
  const flags = bytes[timecodeOffset + 2];
  const lace = (flags & 0x06) >> 1;
  const frameCountOffset = timecodeOffset + 3;
  let frameOffset = frameCountOffset;
  let frameSizes: number[] = [];

  if (lace === 0) {
    frameSizes = [bytes.length - frameOffset];
  } else {
    const laceCount = bytes[frameOffset];
    if (laceCount === undefined) {
      throw new Error('Invalid Matroska block: missing lacing frame count.');
    }
    const frameCount = laceCount + 1;
    frameOffset += 1;

    if (lace === 1) {
      let totalFrameSize = 0;
      for (let frameIndex = 0; frameIndex < frameCount - 1; frameIndex += 1) {
        let frameSize = 0;
        let sizeByte: number;
        do {
          sizeByte = bytes[frameOffset];
          if (sizeByte === undefined) {
            throw new Error('Invalid Matroska block: truncated Xiph lacing sizes.');
          }
          frameSize += sizeByte;
          frameOffset += 1;
        } while (sizeByte === 255);
        frameSizes.push(frameSize);
        totalFrameSize += frameSize;
      }
      frameSizes.push(bytes.length - frameOffset - totalFrameSize);
    } else if (lace === 2) {
      const payloadLength = bytes.length - frameOffset;
      if (payloadLength % frameCount !== 0) {
        throw new Error('Invalid Matroska block: invalid fixed lacing sizes.');
      }
      frameSizes = Array.from({ length: frameCount }, () => payloadLength / frameCount);
    } else {
      const firstSize = readVint(bytes, frameOffset);
      frameOffset += firstSize.length;
      frameSizes.push(firstSize.value);
      let totalFrameSize = firstSize.value;
      for (let frameIndex = 1; frameIndex < frameCount - 1; frameIndex += 1) {
        const encodedSize = readVint(bytes, frameOffset);
        frameOffset += encodedSize.length;
        const bias = (2 ** (7 * encodedSize.length - 1)) - 1;
        const frameSize = encodedSize.value - bias;
        if (frameSize < 0) {
          throw new Error('Invalid Matroska block: negative EBML lacing size.');
        }
        frameSizes.push(frameSize);
        totalFrameSize += frameSize;
      }
      frameSizes.push(bytes.length - frameOffset - totalFrameSize);
    }

    const declaredFramesSize = frameSizes.reduce((total, size) => total + size, 0);
    if (frameSizes.some(size => size < 0) || frameOffset + declaredFramesSize !== bytes.length) {
      throw new Error('Invalid Matroska block: lacing sizes exceed the block payload.');
    }
  }

  const frames: Uint8Array[] = [];
  for (const size of frameSizes) {
    frames.push(bytes.subarray(frameOffset, frameOffset + size));
    frameOffset += size;
  }

  return {
    trackNumber: track.value,
    relativeTimecode,
    frames
  };
}

function getAssDialogueText(packet: string): string {
  const dialogue = packet.match(/^Dialogue:\s*/i);
  const commaCount = dialogue ? 9 : 8;
  let offset = dialogue ? dialogue[0].length : 0;
  for (let index = 0; index < commaCount; index += 1) {
    const comma = packet.indexOf(',', offset);
    if (comma < 0) return dialogue ? packet.slice(offset) : packet;
    offset = comma + 1;
  }
  return packet.slice(offset);
}

function convertAssTextToVtt(text: string): string {
  const content = getAssDialogueText(text.replace(/\0+$/g, '').trim());
  const escaped = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped
    .replace(/\\[Nn]/g, '<br>')
    .replace(/\\h/g, '&nbsp;')
    .replace(/\{([^}]*)\}/g, (_override, commands: string) => {
      let markup = '';
      for (const [, style, enabled] of commands.matchAll(/\\([ibus])([01])/gi)) {
        const tag = style.toLowerCase() === 'i'
          ? 'i'
          : style.toLowerCase() === 'b'
            ? 'b'
            : style.toLowerCase() === 'u'
              ? 'u'
              : 's';
        markup += enabled === '1' ? `<${tag}>` : `</${tag}>`;
      }
      return markup;
    });
}

function packetToText(codec: string, bytes: Uint8Array): string {
  const packet = new TextDecoder().decode(bytes).replace(/\0+$/g, '').trim();
  if (codec === 'S_TEXT/UTF8') {
    return packet
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  return convertAssTextToVtt(packet);
}

function formatTimestamp(milliseconds: number): string {
  const totalMilliseconds = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const fraction = totalMilliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(fraction).padStart(3, '0')}`;
}

function getNumberValue(element: EBMLElementDetail): number | null {
  return 'value' in element && typeof element.value === 'number' ? element.value : null;
}

function getStringValue(element: EBMLElementDetail): string | null {
  return 'value' in element && typeof element.value === 'string' ? element.value : null;
}

function getBinaryValue(element: EBMLElementDetail): Uint8Array | null {
  return 'value' in element && element.value instanceof Uint8Array ? element.value : null;
}

export function extractMkvSubtitleTracks(source: ArrayBuffer | Uint8Array): ExtractedMkvSubtitle[] {
  ensureBufferPolyfill();
  const decoder = new Decoder();
  const bytes = source instanceof ArrayBuffer ? new Uint8Array(source) : source;
  const tracks = new Map<number, MkvTrack>();
  const cues = new Map<number, SubtitleCue[]>();
  let currentTrack: MkvTrack | null = null;
  let currentClusterTimecode = 0;
  let segmentTimestampScale = 1_000_000;
  let currentBlockGroup: BlockGroup | null = null;

  const isSupportedSubtitleBlock = (data: Uint8Array): boolean => {
    const trackNumber = readVint(data, 0).value;
    const track = tracks.get(trackNumber);
    return Boolean(
      track
      && track.type === 17
      && track.codec
      && SUPPORTED_SUBTITLE_CODECS.has(track.codec)
    );
  };

  const addBlock = (block: ParsedBlock, durationTicks: number | null) => {
    const track = tracks.get(block.trackNumber);
    if (!track || track.type !== 17 || !track.codec || !SUPPORTED_SUBTITLE_CODECS.has(track.codec)) {
      return;
    }

    const startMs = Math.max(
      0,
      (
        (currentClusterTimecode + block.relativeTimecode)
        * segmentTimestampScale
        * track.timestampScale
        + track.timestampOffset
      ) / 1_000_000
    );
    const durationMs = durationTicks !== null
      ? durationTicks * segmentTimestampScale * track.timestampScale / 1_000_000
      : track.defaultDuration === null
        ? null
        : track.defaultDuration / 1_000_000;
    const trackCues = cues.get(block.trackNumber) ?? [];
    for (const frame of block.frames) {
      const text = packetToText(track.codec, frame);
      if (text) trackCues.push({ startMs, durationMs, text });
    }
    cues.set(block.trackNumber, trackCues);
  };

  const processElement = (element: EBMLElementDetail) => {
    const isEnd = 'isEnd' in element && element.isEnd;
    if (element.name === 'TrackEntry') {
      if (isEnd) {
        if (currentTrack?.number !== null && currentTrack?.number !== undefined) {
          tracks.set(currentTrack.number, currentTrack);
        }
        currentTrack = null;
      } else {
        currentTrack = {
          number: null,
          type: null,
          codec: null,
          language: 'und',
          name: '',
          timestampScale: 1,
          timestampOffset: 0,
          defaultDuration: null
        };
      }
      return;
    }

    if (element.name === 'Cluster' && !isEnd) {
      currentClusterTimecode = 0;
      return;
    }
    if (element.name === 'BlockGroup') {
      if (isEnd) {
        if (currentBlockGroup?.block) {
          const blockData = currentBlockGroup.block;
          if (isSupportedSubtitleBlock(blockData)) {
            addBlock(parseBlock(blockData), currentBlockGroup.duration);
          }
        }
        currentBlockGroup = null;
      } else {
        currentBlockGroup = { block: null, duration: null };
      }
      return;
    }
    if (element.name === 'Block') {
      const data = getBinaryValue(element);
      if (data && currentBlockGroup) currentBlockGroup.block = data;
      return;
    }
    if (element.name === 'SimpleBlock') {
      const data = getBinaryValue(element);
      if (data && isSupportedSubtitleBlock(data)) addBlock(parseBlock(data), null);
      return;
    }

    const value = getNumberValue(element);
    if (element.name === 'TimestampScale' && value !== null) {
      segmentTimestampScale = value;
    } else if ((element.name === 'Timestamp' || element.name === 'Timecode') && value !== null) {
      currentClusterTimecode = value;
    } else if (element.name === 'BlockDuration' && value !== null && currentBlockGroup) {
      currentBlockGroup.duration = value;
    } else if (currentTrack && value !== null) {
      if (element.name === 'TrackNumber') currentTrack.number = value;
      else if (element.name === 'TrackType') currentTrack.type = value;
      else if (element.name === 'TrackTimestampScale') currentTrack.timestampScale = value;
      else if (element.name === 'TrackOffset' || element.name === 'TrackTimestampOffset') {
        currentTrack.timestampOffset = value;
      }
      else if (element.name === 'DefaultDuration') currentTrack.defaultDuration = value;
    }

    const stringValue = getStringValue(element);
    if (currentTrack && stringValue !== null) {
      if (element.name === 'CodecID') currentTrack.codec = stringValue;
      else if (element.name === 'Language' || element.name === 'LanguageBCP47') currentTrack.language = stringValue;
      else if (element.name === 'Name') currentTrack.name = stringValue;
    }
  };

  for (let offset = 0; offset < bytes.byteLength; offset += DECODE_CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, Math.min(offset + DECODE_CHUNK_SIZE, bytes.byteLength));
    const chunkBuffer = new ArrayBuffer(chunk.byteLength);
    new Uint8Array(chunkBuffer).set(chunk);
    for (const element of decoder.decode(chunkBuffer)) {
      processElement(element);
    }
  }

  return Array.from(tracks.entries())
    .filter(([trackNumber]) => (cues.get(trackNumber)?.length ?? 0) > 0)
    .map(([trackNumber, track]) => {
      const trackCues = cues.get(trackNumber)!;
      trackCues.sort((left, right) => left.startMs - right.startMs);
      const vttCues = trackCues.map((cue, index) => {
        const nextStart = trackCues
          .slice(index + 1)
          .find(nextCue => nextCue.startMs > cue.startMs)?.startMs;
        const duration = cue.durationMs && cue.durationMs > 0
          ? cue.durationMs
          : nextStart === undefined
            ? DEFAULT_CUE_DURATION_MS
            : nextStart - cue.startMs;
        const endMs = cue.startMs + Math.max(1, duration);
        return `${formatTimestamp(cue.startMs)} --> ${formatTimestamp(endMs)}\n${cue.text}`;
      });

      const language = track.language || 'und';
      const codec = track.codec ?? 'subtitle';
      const trackName = track.name ? `${track.name} · ` : '';
      return {
        id: `mkv:${trackNumber}`,
        label: `${trackName}${language} · ${codec}`,
        language,
        webVtt: `WEBVTT\n\n${vttCues.join('\n\n')}\n`
      };
    });
}
