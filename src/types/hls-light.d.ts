// hls.js 1.x не публикует типы для `hls.js/light`: API тот же, что у полной сборки.
declare module 'hls.js/light' {
  export * from 'hls.js';
  export { default } from 'hls.js';
}
