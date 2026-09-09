package org.classroomhub.display;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.provider.Settings;
import android.util.Log;

public class BootReceiver extends BroadcastReceiver {
    private static final String TAG="ClassroomHubDisplay";

    @Override public void onReceive(Context context, Intent intent) {
        SharedPreferences prefs=HubStorage.prefs(context);
        if(prefs.getBoolean("persistent_adb",false)){
            try{
                Settings.Global.putInt(context.getContentResolver(),"development_settings_enabled",1);
                Settings.Global.putInt(context.getContentResolver(),"adb_wifi_enabled",1);
                Log.i(TAG,"Persistent ADB policy restored wireless debugging at boot");
            }catch(SecurityException denied){
                Log.w(TAG,"WRITE_SECURE_SETTINGS is not granted; persistent ADB bootstrap is required",denied);
            }catch(Exception error){
                Log.e(TAG,"Unable to restore wireless debugging",error);
            }
        }

        // LOCKED_BOOT_COMPLETED is used to restore management access as early as
        // Android permits. Launch the WebView kiosk at BOOT_COMPLETED/package
        // replacement when normal application services are ready.
        if(Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(intent.getAction()))return;

        Intent launch=new Intent(context,MainActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP);
        try{context.startActivity(launch);}catch(Exception error){Log.w(TAG,"Unable to launch display activity during boot",error);}
    }
}
