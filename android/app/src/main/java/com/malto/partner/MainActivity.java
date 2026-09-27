package com.malto.partner;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

/**
 * The partner app's native shell.
 *
 * Almost everything the app does happens in the WebView, so this class exists
 * for the two things a WebView cannot do on its own.
 *
 * External links. Every job in the portal carries a Call link, an Email link
 * and an Open in Maps link. Left alone, tapping one navigates the WebView to a
 * scheme it cannot load, and the tap does nothing at all with no error, so a
 * cleaner standing in front of a customer's house gets a dead button. The
 * portal marks them with target="_blank" or a non-http scheme, and
 * shouldOverrideUrlLoading hands each to the system.
 *
 * The back button. Web history would be the right default, but the app loads a
 * single remote page, so a back press would otherwise either close the app
 * mid form or walk the user out of a half-filled booking. It walks the WebView
 * history first, and only leaves the app when there is nothing left to go back
 * to.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Hand anything the WebView will not load to Android instead.
        getBridge().getWebView().setWebViewClient(new android.webkit.WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleExternal(url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest request) {
                return handleExternal(request.getUrl().toString());
            }
        });

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView view = getBridge().getWebView();
                if (view != null && view.canGoBack()) {
                    view.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });
    }

    /**
     * Opens mailto:, tel: and https links in the system handler, and refuses
     * anything else the WebView cannot render.
     *
     * Returns true when the URL was taken off the WebView, so returning true
     * from shouldOverrideUrlLoading is correct in both the "opened it" and the
     * "deliberately dropped it" cases. Dropping silently is intentional: an
     * unrecognized scheme in a partner's job list is not worth an error dialog
     * in the middle of arriving at a job.
     */
    private boolean handleExternal(String url) {
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
        scheme = scheme.toLowerCase();

        // Our own site stays in the WebView, or the app would just be a
        // browser with one bookmark.
        boolean isHttp = "http".equals(scheme) || "https".equals(scheme);
        if (isHttp) {
            String host = uri.getHost();
            if (host != null && host.endsWith("malto-cleaning-services.vercel.app")) {
                return false;
            }
            // Some other site: let the system browser deal with it rather than
            // rendering a page inside a shell that expects our portal.
            openExternally(uri);
            return true;
        }

        if ("mailto".equals(scheme) || "tel".equals(scheme) || "sms".equals(scheme)
                || "geo".equals(scheme) || "maps".equals(scheme)) {
            openExternally(uri);
            return true;
        }

        // Anything else, including intent:// and market:// links.
        return true;
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
