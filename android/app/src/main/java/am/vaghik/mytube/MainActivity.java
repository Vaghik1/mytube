package am.vaghik.mytube;

import android.app.Activity;
import android.app.UiModeManager;
import android.content.res.Configuration;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/**
 * A thin TV shell around the MyTube web app. All the interface lives on the website,
 * so changes you deploy there show up on the TV without reinstalling this app.
 */
public class MainActivity extends Activity {
    private FrameLayout root;
    private WebView web;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private String appUrl;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        appUrl = getString(R.string.app_url);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setUserAgentString(s.getUserAgentString() + " MyTubeTV");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.addJavascriptInterface(new Bridge(), "MyTubeAndroid");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith(appUrl) || url.contains("accounts.google.com")) return false;
                if (!request.isForMainFrame()) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
                } catch (ActivityNotFoundException ignored) {
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    String html = "<html><body style='background:#0f0f0f;color:#eee;font-family:sans-serif;"
                            + "display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh'>"
                            + "<h2>No connection</h2><p>Check the TV's internet, then press OK.</p>"
                            + "<button autofocus style='font-size:20px;padding:10px 30px' onclick=\"location.href='"
                            + appUrl + "'\">Retry</button></body></html>";
                    view.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
                }
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customView = view;
                customViewCallback = callback;
                root.addView(view, new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            }

            @Override
            public void onHideCustomView() {
                hideCustomView();
            }
        });

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(appUrl);
    }

    private void hideCustomView() {
        if (customView == null) return;
        root.removeView(customView);
        customView = null;
        if (customViewCallback != null) customViewCallback.onCustomViewHidden();
        customViewCallback = null;
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        if (code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_ESCAPE) {
            if (event.getAction() == KeyEvent.ACTION_UP) {
                if (customView != null) {
                    hideCustomView();
                } else {
                    web.evaluateJavascript("window.__tvBack ? window.__tvBack() : false", value -> {
                        if (!"true".equals(value)) {
                            if (web.canGoBack()) web.goBack();
                            else finish();
                        }
                    });
                }
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    /** Functions the web app can call: window.MyTubeAndroid.* */
    private class Bridge {
        @JavascriptInterface
        public void openInYouTube(String videoId) {
            runOnUiThread(() -> {
                Uri uri = Uri.parse("https://www.youtube.com/watch?v=" + videoId);
                Intent tv = new Intent(Intent.ACTION_VIEW, uri).setPackage("com.google.android.youtube.tv");
                try {
                    startActivity(tv);
                } catch (ActivityNotFoundException e) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (ActivityNotFoundException ignored) {
                    }
                }
            });
        }

        /** True on Google TV / Android TV, false on phones and tablets. */
        @JavascriptInterface
        public boolean isTv() {
            UiModeManager um = (UiModeManager) getSystemService(UI_MODE_SERVICE);
            return um != null && um.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION;
        }

        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(MainActivity.this::finish);
        }

        @JavascriptInterface
        public String appVersion() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "?";
            }
        }
    }
}
