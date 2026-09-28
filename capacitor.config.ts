import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The partner app is a native shell around the live portal rather than a
 * bundled copy of it.
 *
 * The portal is a Next.js app with server components, so there is nothing to
 * bundle: `webDir` is a placeholder and `server.url` is what actually loads.
 * The payoff is that every fix to the portal reaches the cleaners with no
 * rebuild and no reinstall, and there is only ever one implementation of the
 * job rules, the RLS and the API. The cost is that the app needs the site to be
 * reachable.
 *
 * server.url points at /portal, not at the site root. A partner opening the app
 * wants their jobs, not the marketing site, and a root URL means the first
 * thing a cleaner sees is a "Book a cleaning" button.
 */
const config: CapacitorConfig = {
  appId: "com.malto.partner",
  appName: "MALTO Partner",
  webDir: "www",

  server: {
    androidScheme: "https",
    url: "https://malto-cleaning-services.vercel.app/portal",
    // Only our own site may be loaded in the app. Without this the WebView
    // would follow any link anywhere, which turns the shell into an open
    // browser for anyone who hands a partner a link.
    allowNavigation: ["malto-cleaning-services.vercel.app"],
  },

  android: {
    // Nothing is loaded over plain http, so mixed content is never needed.
    allowMixedContent: false,
    // The portal is a browser inside a browser. Without this, every external
    // link opens inside the app instead of the real browser, and the user has
    // no address bar with which to get back.
    webContentsDebuggingEnabled: false,
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: "#FFFFFF",
      showSpinner: false,
      androidSpinnerStyle: "small",
      splashFullScreen: false,
    },

    /**
     * The notification sound.
     *
     * "malto_job.wav" has to match the filename in res/raw/ exactly, lowercase
     * and with the extension. A mismatch is the quietest possible failure: the
     * Capacitor docs say a missing audio file gives the system sound on Android
     * 7 and *no sound at all* on Android 8+, which is nearly every phone in
     * use. There is no error to notice, so the name is repeated here, in
     * strings.xml, and in CHANNEL_ID, and scripts/check-notification-assets.mjs
     * fails the build if they ever drift.
     */
    LocalNotifications: {
      smallIcon: "ic_stat_malto",
      iconColor: "#3F6B4F",
      sound: "malto_job.wav",
    },

    PushNotifications: {
      // Silent push: the FCM data payload is what we want, because a
      // notification payload is displayed by the OS and arrives too late for
      // the portal to fold it into the list while the app is open. The app
      // posts its own foreground notification through LocalNotifications, on the
      // same channel, so it makes the same sound either way.
      presentationOptions: [],
    },
  },
};

export default config;
