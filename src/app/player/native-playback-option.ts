import type { VideoSkips } from '../api/anime.types';

/**
 * Серия для выбора прямо в плеере. Каталог собирает родитель — плеер о
 * сериях и озвучках ничего не знает, — а поток по выбору поднимает сам плеер.
 */
export interface NativePlaybackOption {
  id: string;
  episode: number;
  dubbing: string;
  /** Локатор серии для резолвера — тот же ключ, что `iframeUrl` плеера. */
  iframeUrl: string;
  skips: VideoSkips;
  /** Серия скачана: играет с диска, резолвить её заранее незачем. */
  local: boolean;
}

/**
 * Ключ досмотренной доли в меню серий. Прогресс в приложении свой у каждой
 * озвучки, поэтому ключ — пара, а не номер, как на фронте.
 */
export function progressKey(dubbing: string, episode: number): string {
  return `${dubbing}\n${episode}`;
}
