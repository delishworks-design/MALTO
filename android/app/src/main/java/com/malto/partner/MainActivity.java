package com.malto.partner;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import java.util.Locale;

/**
 * The partner app's native shell.
 *
 * Almost everything the app does happens in the WebView, so this class exists
 * for the two things a WebView cannot do on its own: route a link to the right
 * app, and stop the partner leaving the portal.
 *
 * Why the WebViewClient is extended rather than replaced
 * ------------------------------------------------------
 * The obvious way to intercept links is getBridge().getWebView()
 * .setWebViewClient(new WebViewClient() { ... }). That compiles, and it
 * silently throws away four things the app needs, because Capacitor's own
 * BridgeWebViewClient is what implements them:
 *
 *   shouldInterceptRequest  On Android 12 and below this is how the Capacitor
 *                           bridge JavaScript reaches the page. On Android 13+
 *                           it uses addDocumentStartJavaScript instead, which is
 *                           independent of the client - but minSdk here is 24,
 *                           so most phones in use take this path and a plain
 *                           WebViewClient leaves them with no bridge at all.
 *   onPageStarted           calls bridge.reset() on every navigation.
 *   onPageFinished          notifies the WebViewListeners, and the SplashScreen
 *                           plugin hides itself from one of them. Replace the
 *                           client and the splash can outlive the page.
 *   shouldOverrideUrlLoading calls bridge.launchIntent for intent:// URLs.
 *
 * So this extends BridgeWebViewClient and calls super, keeping all of it.
 *
 * Why links are fenced to the portal
 * ---------------------------------
 * A partner using the app wants their jobs. Landing on the marketing site, with
 * a "Book a cleaning" button and a back button that goes nowhere useful, is a
 * dead end. Three paths are the whole product: the portal, login and register.
 * Anything else is loaded as /portal instead.
 *
 * This is only half the fence. A Next.js <Link> is a history.pushState rather
 * than a document load, so it never reaches shouldOverrideUrlLoading at all.
 * components/PortalFence.tsx closes that half from the JavaScript side.
 */
public class MainActivity extends BridgeActivity {

    private static final String HOST = "malto-cleaning-services.vercel.app";
    private static final String PORTAL_HOME = "https://" + HOST + "/portal";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Bridge bridge = getBridge();
        if (bridge == null) {
            // BridgeActivity builds the bridge inside super.onCreate(). If it is
            // ever missing there is nothing to configure, and the default client
            // is better than a crash.
            return;
        }

        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return route(view, request.getUrl().toString());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return route(view, url);
            }
        });

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView view = getBridge() == null ? null : getBridge().getWebView();
                if (view != null && view.canGoBack()) {
                    view.goBack();
                } else {
                    // Let the system finish the app only when there is genuinely
                    // nothing to go back to.
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });
    }

    /**
     * Decides what happens to a link.
     *
     * Returns true when the URL has been taken off the WebView, which is
     * correct both when it was opened elsewhere and when it was deliberately
     * dropped. Dropping silently is intentional: an unrecognised scheme in a
     * partner's job list is not worth an error dialog in the middle of arriving
     * at a job.
     */
    private boolean route(WebView view, String url) {
        if (url == null) {
            return false;
        }

        Uri uri;
        try {
            uri = Uri.parse(url);
        } catch (Exception e) {
            return false;
        }

        String scheme = uri.getScheme();
        if (scheme == null) {
            return false;
        }
        scheme = scheme.toLowerCase(Locale.ROOT);

        if ("http".equals(scheme) || "https".equals(scheme)) {
            if (!isOurHost(uri.getHost())) {
                // Some other site. Let the system browser deal with it rather
                // than rendering a page inside a shell that expects our portal,
                // and with no address bar to navigate with.
                openExternally(uri);
                return true;
            }
            if (isPortalPath(uri.getPath())) {
                // False lets the WebView load it, which is also what the
                // inherited implementation would decide for an http URL.
                return false;
            }
            // Our own site, but a page the app must not show. Reload the portal
            // instead. Returning true stops the original load from continuing;
            // the loadUrl below re-enters this method with a path that is
            // allowed, so it terminates immediately rather than looping.
            if (view != null) {
                view.loadUrl(PORTAL_HOME);
            }
            return true;
        }

        if ("mailto".equals(scheme) || "tel".equals(scheme) || "sms".equals(scheme)
                || "geo".equals(scheme) || "maps".equals(scheme)) {
            // Every job carries a Call link, an Email link and an Open in Maps
            // link. Left to the WebView they do nothing at all and give no
            // error, so a cleaner standing in front of a customer's house gets a
            // dead button.
            openExternally(uri);
            return true;
        }

        // Anything else, including intent:// and market://.
        return true;
    }

    private static boolean isOurHost(String host) {
        return host != null && host.equals(HOST);
    }

    /**
     * Mirrors isAppPath() in lib/is-native.ts, which does the same job for
     * client-side navigations. Kept in step deliberately: the two halves of the
     * fence disagreeing is how a partner ends up on the marketing site.
     */
    private static boolean isPortalPath(String path) {
        if (path == null || path.isEmpty() || "/".equals(path)) {
            return false;
        }
        return "/portal".equals(path) || path.startsWith("/portal/");
    }

    private void openExternally(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            // No mail client, no dialler, or nothing that handles geo links.
            // Nothing useful to do here: the cleaner still has the address and
            // phone number on screen to read out or dial by hand.
        }
    }
}
