import { describe, expect, test } from 'bun:test';

import type { Video } from './anime.types';
import {
  anilibriaLocator,
  type AnilibriaRelease,
  isAnilibriaLocator,
  parseAnilibriaLocator,
  pickHls,
  withAnilibria,
} from './anilibria.service';

function kodik(dubbing: string, number: number): Video {
  return {
    videoId: number * 100 + dubbing.length,
    data: { player: 'Плеер Kodik', dubbing },
    number: String(number),
    date: 0,
    iframeUrl: `https://kodik.info/seria/${dubbing}/${number}`,
    index: number,
    skips: {},
  };
}

const release: AnilibriaRelease = {
  releaseId: 9542,
  episodes: [
    { number: 1, duration: 1560, hls: { '1080': 'a1080', '720': 'a720' } },
    { number: 2, duration: 1560, hls: { '480': 'b480' }, skips: { opening: 90 } },
  ],
};

describe('AniLiberty locator', () => {
  test('round-trips shikimori id and episode', () => {
    const locator = anilibriaLocator(52991, 2);

    expect(locator).toBe('anilibria:52991:2');
    expect(isAnilibriaLocator(locator)).toBe(true);
    expect(parseAnilibriaLocator(locator)).toEqual({ shikimoriId: 52991, episode: 2 });
  });

  test('does not take other sources for itself', () => {
    expect(isAnilibriaLocator('cvh:123')).toBe(false);
    expect(parseAnilibriaLocator('https://kodik.info/seria/1')).toBeNull();
  });
});

describe('pickHls', () => {
  test('takes the best playlist not above the wanted quality', () => {
    expect(pickHls({ '1080': 'a', '720': 'b', '480': 'c' }, 720)).toEqual({
      url: 'b',
      height: 720,
    });
    expect(pickHls({ '1080': 'a', '480': 'c' }, 720)).toEqual({ url: 'c', height: 480 });
  });

  test('falls back to the worst one when all are above', () => {
    expect(pickHls({ '1080': 'a', '720': 'b' }, 360)).toEqual({ url: 'b', height: 720 });
  });

  test('gives nothing for an episode without playlists', () => {
    expect(pickHls({}, 720)).toBeNull();
  });
});

describe('withAnilibria', () => {
  test('replaces Kodik episodes of the AniLibria dubbing under the same name', () => {
    const videos = [
      kodik('AniLibria.TV', 1),
      kodik('AniLibria.TV', 2),
      kodik('AniLibria.TV', 3),
      kodik('AniDUB', 1),
    ];

    const merged = withAnilibria(videos, 52991, release);
    const anilibria = merged.filter((video) => video.data.dubbing === 'AniLibria.TV');

    expect(anilibria.map((video) => video.iframeUrl).sort()).toEqual([
      'anilibria:52991:1',
      'anilibria:52991:2',
      'https://kodik.info/seria/AniLibria.TV/3',
    ]);
    expect(merged.filter((video) => video.data.dubbing === 'AniDUB')).toHaveLength(1);
    expect(anilibria.every((video) => video.data.player === 'Плеер Kodik')).toBe(true);
    expect(merged.find((video) => video.iframeUrl === 'anilibria:52991:2')?.skips).toEqual({
      opening: 90,
      ending: undefined,
    });
  });

  test('adds its own dubbing when Kodik has no AniLibria', () => {
    const merged = withAnilibria([kodik('AniDUB', 1)], 52991, release);

    expect(merged.filter((video) => video.data.dubbing === 'AniLibria')).toHaveLength(2);
  });

  test('keeps stable negative ids that never collide with Kodik', () => {
    const merged = withAnilibria([], 52991, release);

    expect(merged.map((video) => video.videoId)).toEqual([-529910001, -529910002]);
  });

  test('leaves the list as is without a release', () => {
    const videos = [kodik('AniLibria.TV', 1)];

    expect(withAnilibria(videos, 52991, null)).toEqual(videos);
  });
});
