package app.treker.tasks;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/**
 * Оболочка над сайтом (BuildInfo.APP_URL): данные синхронизируются через сервер, обновления приходят без новой версии APK.
 * Сначала открывается start.html из assets: он передаёт сайту задачи, оставшиеся от версии 1.0, и показывает экран «нет сети».
 */
public class MainActivity extends Activity {
    private static final String START_URL = "file:///android_asset/start.html";
    private static final int BG = Color.parseColor("#0d0e10");

    private WebView web;

    /** Мост для задач версии 1.0: они лежали в localStorage страницы file://, которую сайт прочитать не может. */
    static final class Bridge {
        private final SharedPreferences prefs;
        Bridge(SharedPreferences prefs) { this.prefs = prefs; }
        @JavascriptInterface public void keep(String json) { prefs.edit().putString("legacy", json).apply(); }
        @JavascriptInterface public String legacy() { return prefs.getString("legacy", null); }
        @JavascriptInterface public String appUrl() { return BuildInfo.APP_URL; }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        web.setBackgroundColor(BG);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowContentAccess(false);
        s.setUserAgentString(s.getUserAgentString() + " TrekerApp/" + BuildInfo.VERSION_NAME);
        web.addJavascriptInterface(new Bridge(getSharedPreferences("treker", MODE_PRIVATE)), "TrekerBridge");

        final String appHost = Uri.parse(BuildInfo.APP_URL).getHost();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("file".equals(uri.getScheme()) || appHost.equals(uri.getHost())) return false;
                // Внешние ссылки открываем в браузере, а не внутри приложения.
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                // Сайт не открылся (нет сети) — показываем свой экран с кнопкой «Повторить».
                if (request.isForMainFrame() && !"file".equals(request.getUrl().getScheme())) {
                    view.loadUrl(START_URL + "?offline=1");
                }
            }
        });

        // Ошибки страницы видны в `adb logcat -s Treker`.
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.i("Treker", m.message() + " @" + m.lineNumber());
                return true;
            }
        });

        // Отступы от системных панелей задаём контейнеру: собственный padding WebView игнорирует.
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setupSystemBars(root);
        setContentView(root);

        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
            web.loadUrl(START_URL);
        }
    }

    /** С Android 11 рисуем под системными панелями сами и отступаем на их высоту и высоту клавиатуры. Тема тёмная — значки панелей светлые. */
    private void setupSystemBars(View root) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                Insets i = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout()
                        | WindowInsets.Type.ime());
                v.setPadding(i.left, i.top, i.right, i.bottom);
                return WindowInsets.CONSUMED;
            });
        }
    }

    /** «Назад» сначала закрывает открытый список, окно настроек или редактирование задачи. */
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript("typeof appBack === 'function' && appBack()", result -> {
            if (!"true".equals(result)) moveTaskToBack(true);
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
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
}
