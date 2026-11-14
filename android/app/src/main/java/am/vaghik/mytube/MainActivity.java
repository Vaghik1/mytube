package am.vaghik.mytube;

import android.app.Activity;
import android.app.PendingIntent;
import android.app.UiModeManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;
import android.content.pm.PackageInstaller;
import android.provider.Settings;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import android.content.res.Configuration;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.graphics.Insets;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.DisplayCutout;
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
    private boolean tv;
    /** Safe-area insets in CSS pixels: top, right, bottom, left. */
    private final float[] safe = new float[4];
    /** Update waiting for the "install unknown apps" permission. */
    private String pendingUpdateUrl;
    private boolean updating;
    private BroadcastReceiver installReceiver;
    private static final String INSTALL_ACTION = "am.vaghik.mytube.INSTALL_STATUS";

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

        tv = isTvDevice();
        if (tv) getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        else setupEdgeToEdge();

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
            public void onPageFinished(WebView view, String url) {
                pushSafeArea();
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
                setSystemBarsHidden(true);
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
        setSystemBarsHidden(false);
        if (customViewCallback != null) customViewCallback.onCustomViewHidden();
        customViewCallback = null;
    }

    private boolean isTvDevice() {
        UiModeManager um = (UiModeManager) getSystemService(UI_MODE_SERVICE);
        return um != null && um.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION;
    }

    /**
     * Phones: draw behind transparent status/navigation bars (Android 15 does this anyway)
     * and tell the page exactly how much space the bars and the notch take,
     * as CSS variables --safe-area-inset-top/right/bottom/left.
     */
    @SuppressWarnings("deprecation")
    private void setupEdgeToEdge() {
        Window w = getWindow();
        w.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30
                    ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            w.setAttributes(lp);
        }
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                // Keep Android's own clock, battery and notification icons visible.
                c.show(WindowInsets.Type.systemBars());
                // Dark app: light status/navigation icons.
                c.setSystemBarsAppearance(0, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
            }
        } else {
            root.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        if (Build.VERSION.SDK_INT >= 21) w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        if (Build.VERSION.SDK_INT < 35) {
            w.setStatusBarColor(Color.TRANSPARENT);
            w.setNavigationBarColor(Color.TRANSPARENT);
        }
        if (Build.VERSION.SDK_INT >= 29) {
            w.setStatusBarContrastEnforced(false);
            w.setNavigationBarContrastEnforced(false);
        }
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            readInsets(insets);
            pushSafeArea();
            return insets; // not consumed: the WebView still gets them for env(safe-area-inset-*)
        });
        root.requestApplyInsets();
    }

    @SuppressWarnings("deprecation")
    private void readInsets(WindowInsets insets) {
        int top, right, bottom, left;
        if (Build.VERSION.SDK_INT >= 30) {
            Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            top = i.top;
            right = i.right;
            bottom = i.bottom;
            left = i.left;
        } else {
            top = insets.getSystemWindowInsetTop();
            right = insets.getSystemWindowInsetRight();
            bottom = insets.getSystemWindowInsetBottom();
            left = insets.getSystemWindowInsetLeft();
            if (Build.VERSION.SDK_INT >= 28) {
                DisplayCutout cut = insets.getDisplayCutout();
                if (cut != null) {
                    top = Math.max(top, cut.getSafeInsetTop());
                    right = Math.max(right, cut.getSafeInsetRight());
                    bottom = Math.max(bottom, cut.getSafeInsetBottom());
                    left = Math.max(left, cut.getSafeInsetLeft());
                }
            }
        }
        float d = getResources().getDisplayMetrics().density;
        safe[0] = top / d;
        safe[1] = right / d;
        safe[2] = bottom / d;
        safe[3] = left / d;
    }

    private void pushSafeArea() {
        if (tv || web == null) return;
        String js = "(function(s){"
                + "s.setProperty('--safe-area-inset-top','" + safe[0] + "px');"
                + "s.setProperty('--safe-area-inset-right','" + safe[1] + "px');"
                + "s.setProperty('--safe-area-inset-bottom','" + safe[2] + "px');"
                + "s.setProperty('--safe-area-inset-left','" + safe[3] + "px');"
                + "})(document.documentElement.style);";
        web.evaluateJavascript(js, null);
    }

    /** Full-screen video on phones hides the status and navigation bars (swipe to show). */
    @SuppressWarnings("deprecation")
    private void setSystemBarsHidden(boolean hidden) {
        if (tv) return;
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c == null) return;
            if (hidden) {
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                c.hide(WindowInsets.Type.systemBars());
            } else {
                c.show(WindowInsets.Type.systemBars());
            }
        } else {
            int base = View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
            root.setSystemUiVisibility(hidden
                    ? base | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    : base);
        }
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
        // Back from the "install unknown apps" screen: continue the update if it's allowed now.
        if (pendingUpdateUrl != null && canInstall()) {
            String url = pendingUpdateUrl;
            pendingUpdateUrl = null;
            startUpdate(url);
        }
    }

    // ── Self-update ──────────────────────────────────────────────

    private void updateStatus(String status, String value) {
        String v = value == null ? "null" : "'" + value.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ") + "'";
        runOnUiThread(() -> web.evaluateJavascript(
                "window.__mytubeUpdate && window.__mytubeUpdate('" + status + "', " + v + ")", null));
    }

    private boolean canInstall() {
        return Build.VERSION.SDK_INT < 26 || getPackageManager().canRequestPackageInstalls();
    }

    private void startUpdate(String url) {
        if (updating) return;
        if (!url.startsWith("https://github.com/") && !url.startsWith("https://objects.githubusercontent.com/")) {
            updateStatus("error", "Unexpected download address");
            return;
        }
        if (!canInstall()) {
            pendingUpdateUrl = url;
            updateStatus("permission", null);
            try {
                startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getPackageName())));
            } catch (ActivityNotFoundException e) {
                pendingUpdateUrl = null;
                updateStatus("error", "Turn on Install unknown apps for MyTube in Android settings");
            }
            return;
        }
        updating = true;
        new Thread(() -> {
            PackageInstaller.Session session = null;
            try {
                PackageInstaller installer = getPackageManager().getPackageInstaller();
                PackageInstaller.SessionParams params =
                        new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                params.setAppPackageName(getPackageName());
                if (Build.VERSION.SDK_INT >= 31) {
                    // Once MyTube installed itself, Android may let later updates through without asking.
                    params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
                }
                int id = installer.createSession(params);
                session = installer.openSession(id);

                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                if (conn.getResponseCode() != 200) throw new Exception("Download failed (" + conn.getResponseCode() + ")");
                long total = conn.getContentLengthLong();
                try (InputStream in = conn.getInputStream();
                     OutputStream out = session.openWrite("mytube.apk", 0, total > 0 ? total : -1)) {
                    byte[] buf = new byte[64 * 1024];
                    long done = 0;
                    int lastPct = -1, n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        done += n;
                        int pct = total > 0 ? (int) (done * 100 / total) : 0;
                        if (pct != lastPct) {
                            lastPct = pct;
                            updateStatus("downloading", String.valueOf(pct));
                        }
                    }
                    session.fsync(out);
                }
                runOnUiThread(this::registerInstallReceiver);
                Intent status = new Intent(INSTALL_ACTION).setPackage(getPackageName());
                int flags = PendingIntent.FLAG_UPDATE_CURRENT
                        | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                PendingIntent pi = PendingIntent.getBroadcast(this, id, status, flags);
                session.commit(pi.getIntentSender());
                session.close();
            } catch (Exception e) {
                if (session != null) session.abandon();
                updating = false;
                updateStatus("error", e.getMessage() == null ? "Update failed" : e.getMessage());
            }
        }).start();
    }

    @SuppressWarnings("deprecation")
    private void registerInstallReceiver() {
        if (installReceiver != null) return;
        installReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                int st = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
                if (st == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                    Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                    if (confirm != null) {
                        updateStatus("confirm", null);
                        startActivity(confirm);
                    }
                    return;
                }
                updating = false;
                if (st == PackageInstaller.STATUS_SUCCESS) return; // Android restarts MyTube on the new version
                if (st == PackageInstaller.STATUS_FAILURE_ABORTED) updateStatus("cancelled", null);
                else updateStatus("error", intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE));
            }
        };
        IntentFilter filter = new IntentFilter(INSTALL_ACTION);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(installReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(installReceiver, filter);
    }

    @Override
    protected void onDestroy() {
        if (installReceiver != null) unregisterReceiver(installReceiver);
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
            return tv;
        }

        /** Download the APK at this address and ask Android to install it over this app. */
        @JavascriptInterface
        public void installUpdate(String url) {
            runOnUiThread(() -> startUpdate(url));
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
