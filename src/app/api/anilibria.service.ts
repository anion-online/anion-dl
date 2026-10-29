import { inject, Injectable } from '@angular/core';

import type { Video } from './anime.types';
import { ApiClient, isApiError } from './http';
import { isKodik, KODIK_PLAYER } from './video-source';

/**
 * Серии AniLiberty (бывшая AniLibria) — третий источник, общий с фронтом.
 *
 * Сопоставление тайтла с релизом держит бэк (`GET /playback/anilibria`,
 * решения — `anion/docs/superpowers/specs/2026-10-21-anilibria-fallback-design.md`).
 * Ссылки на HLS не подписаны и не истекают, CDN отдаёт CORS любому origin,
 * поэтому плеер берёт поток напрямую, без Rust и без прокси, а ffmpeg качает
 * его тем же конвейером, что и Kodik.
 */

/** Как отдаёт бэк: только имеющиеся качества, номера серий целые. */
export interface AnilibriaEpisode {
  number: number;
  duration: number;
  hls: Partial<Record<'480' | '720' | '1080', string>>;
  skips?: { opening?: number; ending?: number };
}

export interface AnilibriaRelease {
  releaseId: number;
  episodes: AnilibriaEpisode[];
}

export const ANILIBRIA_QUALITIES = [1080, 720, 480] as const;

/**
 * Локатор серии: `anilibria:<shikimoriId>:<номер>`.
 *
 * На фронте в нём `releaseId`: страница там одна, и релиз к резолву уже
 * загружен. Здесь серию резолвят и окно плеера, и очередь загрузок, где
 * релиза в памяти нет, а бэк ищет его только по shikimori id — поэтому в
 * локаторе он. Локатор сохраняется в задачах и прогрессе, менять форму нельзя.
 */
const LOCATOR = /^anilibria:(\d+):(\d+)$/;

export function anilibriaLocator(shikimoriId: number, episode: number): string {
  return `anilibria:${shikimoriId}:${episode}`;
}

export function parseAnilibriaLocator(
  locator: string
): { shikimoriId: number; episode: number } | null {
  const match = LOCATOR.exec(locator);
  return match
    ? { shikimoriId: Number(match[1]), episode: Number(match[2]) }
    : null;
}

export function isAnilibriaLocator(locator: string): boolean {
  return LOCATOR.test(locator);
}

/** Лучший плейлист не выше `quality`; если все выше — худший из имеющихся. */
export function pickHls(
  hls: AnilibriaEpisode['hls'],
  quality: number
): { url: string; height: number } | null {
  const available = ANILIBRIA_QUALITIES.filter((height) => hls[`${height}`]);
  const height =
    available.find((candidate) => candidate <= quality) ?? available.at(-1);
  const url = height === undefined ? undefined : hls[`${height}`];
  return height !== undefined && url ? { url, height } : null;
}

/** Своя озвучка AniLiberty, если у Kodik её нет. */
const FALLBACK_DUBBING = 'AniLibria';

function isAnilibriaDubbing(dubbing: string): boolean {
  return dubbing.toLowerCase().replace(/[^a-z]/g, '').includes('anilibria');
}

/**
 * Видео тайтла вместе с релизом AniLiberty — как `withAnilibria` фронта.
 *
 * Озвучка AniLibria остаётся одной строкой: серии AniLiberty встают под имя
 * её Kodik вместо его серий с тем же номером (1080p вместо 720p), а Kodik
 * остаётся там, где AniLiberty отстаёт. Строка озвучки — идентичность
 * дорожки (прогресс, окно, имя файла), поэтому иначе одна студия
 * раздвоилась бы. Без Kodik в этой озвучке AniLiberty идёт под своей.
 */
export function withAnilibria(
  videos: readonly Video[],
  shikimoriId: number,
  release: AnilibriaRelease | null
): Video[] {
  if (!release || release.episodes.length === 0) {
    return [...videos];
  }

  const kodik = videos.find(
    (video) => isKodik(video) && isAnilibriaDubbing(video.data.dubbing)
  );
  const dubbing = kodik?.data.dubbing ?? FALLBACK_DUBBING;
  const player = kodik?.data.player ?? KODIK_PLAYER;

  const own: Video[] = release.episodes.map((episode, index) => ({
    // Id задачи загрузки и ключ в списках — стабильный между запусками и не
    // пересекается с положительными id Kodik.
    videoId: -(shikimoriId * 10_000 + episode.number),
    data: { player, dubbing },
    number: String(episode.number),
    date: 0,
    iframeUrl: anilibriaLocator(shikimoriId, episode.number),
    index,
    skips: {
      opening: episode.skips?.opening,
      ending: episode.skips?.ending,
    },
  }));

  const covered = new Set(own.map((video) => video.number));
  return [
    ...videos.filter(
      (video) =>
        video.data.dubbing !== dubbing ||
        !isKodik(video) ||
        !covered.has(video.number)
    ),
    ...own,
  ];
}

/** Как у `AnimeService`: страница тайтла открывается туда-обратно часто. */
const CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class AnilibriaService {
  private readonly api = inject(ApiClient);
  private readonly cache = new Map<
    number,
    { promise: Promise<AnilibriaRelease | null>; expiresAt: number }
  >();
  /** Пришедшие релизы — для синхронного списка качеств серии. */
  private readonly loaded = new Map<number, AnilibriaRelease>();

  /**
   * Никогда не падает: источник — дополнение, его недоступность не должна
   * мешать Kodik. `null` — релиза нет; отказ сети не кэшируется.
   */
  release(shikimoriId: number): Promise<AnilibriaRelease | null> {
    const cached = this.cache.get(shikimoriId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.promise;
    }

    const promise = this.api
      .get<AnilibriaRelease>(`/playback/anilibria?shikimoriId=${shikimoriId}`)
      .then((release) => {
        this.loaded.set(shikimoriId, release);
        return release;
      })
      .catch((error: unknown) => {
        // 404 — релиза у тайтла нет, это ответ, а не сбой.
        if (!isApiError(error) || error.status !== 404) {
          console.warn('AniLiberty недоступен', error);
          this.cache.delete(shikimoriId);
        }
        return null;
      });

    this.cache.set(shikimoriId, {
      promise,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return promise;
  }

  /**
   * Качества серии от лучшего к худшему: у старых релизов 1080p нет. Пока
   * релиз не загружен — вся лестница, резолв всё равно возьмёт ближайшее.
   */
  qualitiesFor(locator: string): readonly number[] {
    const parsed = parseAnilibriaLocator(locator);
    const episode = parsed
      ? this.loaded
          .get(parsed.shikimoriId)
          ?.episodes.find((candidate) => candidate.number === parsed.episode)
      : undefined;
    const available = ANILIBRIA_QUALITIES.filter(
      (height) => episode?.hls[`${height}`]
    );
    return available.length > 0 ? available : ANILIBRIA_QUALITIES;
  }

  /** Плейлист серии лучшего качества не выше `quality`. */
  async resolve(
    locator: string,
    quality: number
  ): Promise<{ url: string; height: number }> {
    const parsed = parseAnilibriaLocator(locator);
    if (!parsed) {
      throw new Error(`Не локатор AniLiberty: ${locator}`);
    }

    const release = await this.release(parsed.shikimoriId);
    const episode = release?.episodes.find(
      (candidate) => candidate.number === parsed.episode
    );
    const manifest = episode && pickHls(episode.hls, quality);
    if (!manifest) {
      throw new Error('Серии больше нет у AniLiberty');
    }
    return manifest;
  }
}
