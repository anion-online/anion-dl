import { inject, Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';

import { AnilibriaService, isAnilibriaLocator } from './anilibria.service';
import { qualitiesFor } from './video-source';

/**
 * Поток серии: манифест и заголовки, без которых CDN его не отдаст.
 * Зеркало `resolver::Stream` — загрузчик передаёт его в Rust как есть.
 */
export interface ResolvedStream {
  url: string;
  referer: string | null;
  userAgent: string | null;
  /** Высота кадра, если источник её знает; у Kodik она в имени манифеста. */
  height: number | null;
}

/**
 * Обёртка над Rust-командой resolve_manifest.
 *
 * Резолв делается непосредственно перед скачиванием, а не заранее для всей
 * очереди: URL сегментов подписан и протухает, так что заготовленный впрок
 * манифест к моменту старта ffmpeg окажется мёртвым.
 *
 * Первый аргумент — локатор серии: URL плеера Kodik, `cvh:<vkId>` или
 * `anilibria:<shikimoriId>:<номер>`. Последний резолвится без Rust: ссылки
 * AniLiberty не подписаны и приходят с бэка готовыми.
 */
@Injectable({ providedIn: 'root' })
export class ResolverService {
  private readonly anilibria = inject(AnilibriaService);

  /** Качества, которые стоит предлагать для серии: у каждого источника свой потолок. */
  qualitiesFor(locator: string): readonly number[] {
    return isAnilibriaLocator(locator)
      ? this.anilibria.qualitiesFor(locator)
      : qualitiesFor(locator);
  }

  /**
   * Ссылка готова заранее и не зависит от сайта источника. Сбой резолва у
   * такой серии — не сбой провайдера, и другой источник предлагать незачем.
   */
  isDirect(locator: string): boolean {
    return isAnilibriaLocator(locator);
  }

  /**
   * @param preferredQuality высота кадра. Если такой нет, Rust берёт лучшую
   * доступную ниже.
   */
  resolveStream(
    iframeUrl: string,
    preferredQuality: number
  ): Promise<ResolvedStream> {
    if (isAnilibriaLocator(iframeUrl)) {
      return this.anilibria
        .resolve(iframeUrl, preferredQuality)
        .then(({ url, height }) => ({
          url,
          referer: null,
          userAgent: null,
          height,
        }));
    }

    return invoke<ResolvedStream>('resolve_manifest', {
      iframeUrl,
      preferredQuality,
    });
  }

  /**
   * Адрес для плеера. Kodik — прямой URL CDN; поток, которому нужны
   * заголовки, недоступные вебвью (CDNVideoHub), — адрес прокси
   * `stream://…`, см. `stream_proxy.rs`.
   */
  resolvePlayback(
    iframeUrl: string,
    preferredQuality: number
  ): Promise<string> {
    if (isAnilibriaLocator(iframeUrl)) {
      return this.anilibria
        .resolve(iframeUrl, preferredQuality)
        .then(({ url }) => url);
    }

    return invoke<string>('resolve_playback', {
      iframeUrl,
      preferredQuality,
    });
  }

  /**
   * Меняет качество потока плеера. У Kodik — подменой в уже подписанном URL,
   * у потока через прокси — новым резолвом той же серии. У AniLiberty
   * плейлисты всех качеств и так известны — берётся соседний по локатору.
   */
  changeManifestQuality(
    iframeUrl: string,
    manifestUrl: string,
    preferredQuality: number
  ): Promise<string> {
    if (isAnilibriaLocator(iframeUrl)) {
      return this.resolvePlayback(iframeUrl, preferredQuality);
    }

    return invoke<string>('change_manifest_quality', {
      manifestUrl,
      preferredQuality,
    });
  }
}
