package org.classroomhub.display;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private WebView webView;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        enterImmersive();
        webView = new WebView(this);
        WebSettings settings=webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient());
        setContentView(webView);
        loadConfiguredUrl();
    }

    private void enterImmersive(){
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    private void loadConfiguredUrl(){
        String url=HubStorage.prefs(this).getString("display_url","");
        if(url==null||url.trim().isEmpty())webView.loadData("<html><body style='background:#0b1017;color:white;font-family:sans-serif;padding:8vw'><h1>Classroom Hub Display</h1><p>This device is installed but has not been assigned a display URL.</p></body></html>","text/html","UTF-8");
        else webView.loadUrl(url);
    }

    @Override protected void onResume(){super.onResume();enterImmersive();if(webView!=null)loadConfiguredUrl();}
    @Override public void onBackPressed(){/* Kiosk mode: suppress accidental exit. */}
}
