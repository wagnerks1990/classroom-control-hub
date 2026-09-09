package org.classroomhub.display;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.provider.Settings;

public class ConfigReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        SharedPreferences prefs=HubStorage.prefs(context);
        SharedPreferences.Editor edit=prefs.edit();
        String url=intent.getStringExtra("display_url");
        if(url!=null&&(url.startsWith("http://")||url.startsWith("https://"))) edit.putString("display_url",url);
        if(intent.hasExtra("persistent_adb")) edit.putBoolean("persistent_adb",intent.getBooleanExtra("persistent_adb",false));
        if(intent.hasExtra("target_adb_port")) edit.putInt("target_adb_port",Math.max(1024,Math.min(65535,intent.getIntExtra("target_adb_port",5555))));
        edit.apply();
        if(prefs.getBoolean("persistent_adb",false)){
            try{
                Settings.Global.putInt(context.getContentResolver(),"development_settings_enabled",1);
                Settings.Global.putInt(context.getContentResolver(),"adb_wifi_enabled",1);
            }catch(Exception ignored){}
        }
        Intent launch=new Intent(context,MainActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP);
        try{context.startActivity(launch);}catch(Exception ignored){}
    }
}
