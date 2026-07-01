import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.vonderthwood.genius',
  appName: 'GEnius',
  webDir: 'mobile/www',
  // Routes window.fetch/XMLHttpRequest through native HTTP instead of the
  // webview's own networking stack — confirmed for real: the WeirdGloop
  // price-dump endpoint doesn't send CORS headers, so a plain webview
  // fetch() to it gets blocked by the browser's CORS model entirely (this
  // doesn't exist in Electron's main process, which is why it never
  // showed up on desktop). Native HTTP has no concept of "origin" at all,
  // so this sidesteps the problem outright rather than needing every
  // third-party endpoint we hit to cooperate with CORS.
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    // Periodic background notification checks via Android WorkManager (and
    // iOS BGTaskScheduler) — runs mobile/runners/background.js headlessly,
    // even while GEnius is fully closed, with no foreground service or
    // persistent notification. Minimum repeat interval Android honors is
    // 15 minutes regardless of what's set here; actual timing is also
    // subject to OS battery optimization and isn't guaranteed exact.
    BackgroundRunner: {
      label: 'com.vonderthwood.genius.background.task',
      src: 'runners/background.js',
      event: 'checkNotifications',
      repeat: true,
      interval: 15,
      autoStart: true,
    },
  },
};

export default config;
