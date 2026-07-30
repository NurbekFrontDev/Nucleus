// Единая точка правды о версии приложения.
// __APP_VERSION__ подставляется Vite при сборке из поля version в package.json
// (см. define в vite.config.ts), поэтому номер версии нигде не дублируется
// руками и всегда совпадает с версией установщика Windows и APK.
export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'
