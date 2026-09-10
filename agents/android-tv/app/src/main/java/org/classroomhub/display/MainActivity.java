package org.classroomhub.display;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private static final String TAG="ClassroomHubDisplay";
    private static final long POLICY_INTERVAL_MS=30000L;
    private static final String EXTRA_RELOAD="agent_reload";
    private WebView webView;
    private final Handler policyHandler=new Handler(Looper.getMainLooper());
    private final Runnable policyWatchdog=new Runnable(){
        @Override public void run(){
            enforceManagementPolicy("watchdog");
            policyHandler.postDelayed(this,POLICY_INTERVAL_MS);
        }
    };

    static void launch(Context context,boolean reload){
        Intent launch=new Intent(context,MainActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if(reload)launch.putExtra(EXTRA_RELOAD,true);
        try{context.startActivity(launch);}catch(Exception error){Log.w(TAG,"Unable to launch display activity",error);}
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        AgentService.start(this);
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
        startPolicyWatchdog();
    }

    @Override protected void onNewIntent(Intent intent){
        super.onNewIntent(intent);
        setIntent(intent);
        enterImmersive();
        if(intent!=null&&intent.getBooleanExtra(EXTRA_RELOAD,false)&&webView!=null)webView.reload();
        else loadConfiguredUrl();
    }

    private void enterImmersive(){
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    private void loadConfiguredUrl(){
        if(webView==null)return;
        String url=HubStorage.prefs(this).getString("display_url","");
        if(url==null||url.trim().isEmpty())webView.loadData("<html><body style='background:#0b1017;color:white;font-family:sans-serif;padding:8vw'><h1>Classroom Hub Display</h1><p>This device is installed but has not been assigned a display URL.</p></body></html>","text/html","UTF-8");
        else webView.loadUrl(url);
    }

    private void startPolicyWatchdog(){
        policyHandler.removeCallbacks(policyWatchdog);
        enforceManagementPolicy("activity-start");
        policyHandler.postDelayed(policyWatchdog,POLICY_INTERVAL_MS);
    }

    private void enforceManagementPolicy(String source){
        SharedPreferences prefs=HubStorage.prefs(this);
        if(!prefs.getBoolean("persistent_adb",false))return;
        try{
            int developer=Settings.Global.getInt(getContentResolver(),"development_settings_enabled",0);
            int wireless=Settings.Global.getInt(getContentResolver(),"adb_wifi_enabled",0);
            boolean repaired=false;
            if(developer!=1){Settings.Global.putInt(getContentResolver(),"development_settings_enabled",1);repaired=true;}
            if(wireless!=1){Settings.Global.putInt(getContentResolver(),"adb_wifi_enabled",1);repaired=true;}
            int currentWireless=Settings.Global.getInt(getContentResolver(),"adb_wifi_enabled",0);
            if(repaired)Log.w(TAG,"Management watchdog repaired wireless debugging from "+source+"; adb_wifi_enabled="+currentWireless);
            else Log.d(TAG,"Management watchdog verified wireless debugging from "+source+"; adb_wifi_enabled="+currentWireless);
        }catch(SecurityException denied){
            Log.w(TAG,"Management watchdog lacks WRITE_SECURE_SETTINGS; run Persistent ADB bootstrap once",denied);
        }catch(Exception error){
            Log.e(TAG,"Management watchdog failed to verify wireless debugging",error);
        }
    }

    @Override protected void onResume(){
        super.onResume();
        AgentService.start(this);
        enterImmersive();
        enforceManagementPolicy("resume");
        if(webView!=null)loadConfiguredUrl();
    }

    @Override protected void onDestroy(){
        policyHandler.removeCallbacks(policyWatchdog);
        if(webView!=null){webView.destroy();webView=null;}
        super.onDestroy();
    }

    @Override public void onBackPressed(){/* Kiosk mode: suppress accidental exit. */}
}
