package org.classroomhub.display;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Settings;

/** Opens Android's Accessibility settings from a foreground activity so TV background-launch policy cannot swallow it. */
public class AccessibilityActivationActivity extends Activity {
    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            Intent intent=new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
            startActivityForResult(intent,2001);
        } catch(Exception error) {
            Intent fallback=new Intent(Settings.ACTION_SETTINGS);
            startActivityForResult(fallback,2001);
        }
    }

    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){
        super.onActivityResult(requestCode,resultCode,data);
        if(requestCode==2001)finish();
    }
}
