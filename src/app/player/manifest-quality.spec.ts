import { describe, expect, test } from 'bun:test';

import { qualityOf } from './manifest-quality';

describe('qualityOf', () => {
  test('читает качество живого манифеста', () => {
    expect(
      qualityOf(
        'https://cloud.solodcdn.com/useruploads/f9b95698/0ba8f24:2026091809/720.mp4:hls:manifest.m3u8'
      )
    ).toBe(720);
  });

  test('не путается с цифрами в пути', () => {
    expect(qualityOf('https://cdn/2026091809/x/360.mp4:hls:manifest.m3u8')).toBe(
      360
    );
  });

  test('читает высоту из адреса прокси', () => {
    expect(qualityOf('stream://localhost/0af3/1080p.m3u8')).toBe(1080);
    expect(qualityOf('http://stream.localhost/0af3/720p.m3u8')).toBe(720);
  });

  test('чужой формат ссылки — null, а не догадка', () => {
    expect(qualityOf('https://cdn/stream/manifest.m3u8')).toBeNull();
  });
});

test('reads the quality of an AniLiberty playlist from its directory', () => {
  expect(
    qualityOf(
      'https://cache.libria.fun/videos/media/ts/9542/1/720/f2dc34029cefbeb93e9fbb4c5cfbfa5d.m3u8'
    )
  ).toBe(720);
});
