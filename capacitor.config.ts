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
 * reachable, and there is no offline job list.
 */
const config: CapacitorConfig = {
  appId: "com.malto.partner",
  appName: "MALTO Partner",
  webDir: "www",

  server: {
    androidScheme: "https",
    url: "https://malto-cleaning-services.vercel.app",
    // Only our own site may be loaded in the app. Without this the WebView
    // would follow any link anywhere, which turns the shell into an open
    // browser for anyone who hands a partner a link.
    allowNavigation: ["malto-cleaning-services.vercel.app"],
  },

  android: {
    // Nothing is loaded over plain http, so mixed content is never needed.
    allowMixedContent: false,
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: "#FFFFFF",
      showSpinner: false,
      androidSpinnerStyle: "small",
      splashFullScreen: false,
    },
  },
};

export default config;
