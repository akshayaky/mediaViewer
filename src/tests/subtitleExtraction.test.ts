import { describe, expect, it } from 'vitest';
import { createMkvSubtitleExtractor, extractMkvAudioTracks, extractMkvSubtitleTracks } from '../services/SubtitleExtraction';

function concatenate(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function encodeSize(size: number): Uint8Array {
  for (let length = 1; length <= 8; length += 1) {
    if (size < 2 ** (7 * length) - 1) {
      const encoded = size + 2 ** (7 * length);
      const bytes = new Uint8Array(length);
      for (let index = length - 1; index >= 0; index -= 1) {
        bytes[index] = encoded / 2 ** (8 * (length - index - 1)) & 0xff;
      }
      return bytes;
    }
  }
  throw new Error('Test EBML element is too large.');
}

function element(id: number[], payload: Uint8Array): Uint8Array {
  return concatenate(Uint8Array.from(id), encodeSize(payload.length), payload);
}

function unsignedElement(id: number[], value: number): Uint8Array {
  let length = 1;
  while (value >= 2 ** (length * 8)) length += 1;
  const bytes = new Uint8Array(length);
  for (let index = length - 1; index >= 0; index -= 1) {
    bytes[index] = value / 2 ** (8 * (length - index - 1)) & 0xff;
  }
  return element(id, bytes);
}

function stringElement(id: number[], value: string): Uint8Array {
  return element(id, new TextEncoder().encode(value));
}

function trackEntry(number: number, codec: string, type = 17): Uint8Array {
  return element([0xae], concatenate(
    unsignedElement([0xd7], number),
    unsignedElement([0x83], type),
    stringElement([0x86], codec),
    stringElement([0x22, 0xb5, 0x9c], 'eng')
  ));
}

function block(trackNumber: number, text: string): Uint8Array {
  const textBytes = new TextEncoder().encode(text);
  return concatenate(
    Uint8Array.of(0x80 | trackNumber, 0, 0, 0),
    textBytes
  );
}

function xiphLacedBlock(trackNumber: number, packets: string[]): Uint8Array {
  const frames = packets.map(packet => new TextEncoder().encode(packet));
  const sizeHeaders: number[] = [];
  for (const frame of frames.slice(0, -1)) {
    let remainingSize = frame.length;
    while (remainingSize >= 255) {
      sizeHeaders.push(255);
      remainingSize -= 255;
    }
    sizeHeaders.push(remainingSize);
  }
  return concatenate(
    Uint8Array.of(0x80 | trackNumber, 0, 0, 0x02, frames.length - 1, ...sizeHeaders),
    ...frames
  );
}

function makeMkv(extraBlocks: Uint8Array = new Uint8Array(), extraTracks: Uint8Array[] = []): ArrayBuffer {
  const trackMetadata = element([0x16, 0x54, 0xae, 0x6b], concatenate(
    trackEntry(1, 'S_TEXT/UTF8'),
    trackEntry(2, 'S_TEXT/ASS'),
    ...extraTracks
  ));
  const utf8Block = element([0xa3], block(1, 'Hello <world>'));
  const assBlock = element([0xa1], block(2, '0,0,Default,,0,0,0,,{\\i1}Hi{\\i0}\\Nthere'));
  const assGroup = element([0xa0], concatenate(assBlock, unsignedElement([0x9b], 1500)));
  const cluster = element([0x1f, 0x43, 0xb6, 0x75], concatenate(
    unsignedElement([0xe7], 1000),
    utf8Block,
    assGroup,
    extraBlocks
  ));
  const segment = element([0x18, 0x53, 0x80, 0x67], concatenate(trackMetadata, cluster));
  const buffer = new ArrayBuffer(segment.length);
  new Uint8Array(buffer).set(segment);
  return buffer;
}

describe('MKV subtitle extraction', () => {
  it('converts UTF8 and ASS subtitle packets into WebVTT tracks', () => {
    const tracks = extractMkvSubtitleTracks(makeMkv());

    expect(tracks).toHaveLength(2);
    expect(tracks[0]).toMatchObject({
      id: 'mkv:1',
      language: 'eng'
    });
    expect(tracks[0].webVtt).toContain('00:00:01.000 --> 00:00:06.000');
    expect(tracks[0].webVtt).toContain('Hello &lt;world&gt;');
    expect(tracks[1].webVtt).toContain('00:00:01.000 --> 00:00:02.500');
    expect(tracks[1].webVtt).toContain('<i>Hi</i><br>there');
  });

  it('extracts tracks from incrementally supplied file chunks', () => {
    const bytes = new Uint8Array(makeMkv());
    const extractor = createMkvSubtitleExtractor();
    for (let offset = 0; offset < bytes.length; offset += 3) {
      extractor.push(bytes.subarray(offset, offset + 3));
    }

    expect(extractor.finish()).toEqual(extractMkvSubtitleTracks(bytes));
  });

  it('derives the final frame size for Xiph-laced subtitle packets', () => {
    const lacedBlock = element(
      [0xa3],
      xiphLacedBlock(1, ['First packet', 'Second packet'])
    );
    const tracks = extractMkvSubtitleTracks(makeMkv(lacedBlock));

    expect(tracks[0].webVtt).toContain('First packet');
    expect(tracks[0].webVtt).toContain('Second packet');
  });

  it('ignores malformed laced blocks belonging to non-subtitle tracks', () => {
    const malformedAudioBlock = element(
      [0xa3],
      Uint8Array.of(0x83, 0, 0, 0x06, 0x02, 0x81, 0x80, 0x41, 0x42, 0x43)
    );
    const tracks = extractMkvSubtitleTracks(
      makeMkv(malformedAudioBlock, [trackEntry(3, 'A_AAC', 2)])
    );

    expect(tracks).toHaveLength(2);
    expect(tracks[0].webVtt).toContain('Hello &lt;world&gt;');
  });

  it('extracts audio track metadata from MKV containers', () => {
    const audioMetadata = element([0x16, 0x54, 0xae, 0x6b], concatenate(
      trackEntry(1, 'A_AAC', 2),
      trackEntry(2, 'A_AC3', 2)
    ));
    const segment = element([0x18, 0x53, 0x80, 0x67], concatenate(audioMetadata));
    const buffer = new ArrayBuffer(segment.length);
    new Uint8Array(buffer).set(segment);

    const tracks = extractMkvAudioTracks(buffer);

    expect(tracks).toHaveLength(2);
    expect(tracks[0]).toMatchObject({
      id: 'mkv:1',
      language: 'eng',
      codec: 'A_AAC'
    });
    expect(tracks[0].label).toContain('eng');
    expect(tracks[1].label).toContain('A_AC3');
  });

  it('provides the Buffer polyfill when the browser global is unavailable', () => {
    const originalBuffer = globalThis.Buffer;
    Object.defineProperty(globalThis, 'Buffer', {
      configurable: true,
      value: undefined,
      writable: true
    });

    try {
      expect(extractMkvSubtitleTracks(makeMkv())).toHaveLength(2);
    } finally {
      Object.defineProperty(globalThis, 'Buffer', {
        configurable: true,
        value: originalBuffer,
        writable: true
      });
    }
  });
});
