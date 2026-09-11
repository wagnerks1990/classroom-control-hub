package org.classroomhub.display;

import android.app.Activity;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Settings;

public class DeviceAdminActivationActivity extends Activity {
    private static final int REQUEST_ADMIN=1001;

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ComponentName admin=new ComponentName(this,AgentDeviceAdminReceiver.class);
        DevicePolicyManager dpm=(DevicePolicyManager)getSystemService(DEVICE_POLICY_SERVICE);
        if(dpm!=null&&dpm.isAdminActive(admin)){finish();return;}
        try{
            Intent intent=new Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN);
            intent.putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN,admin);
            intent.putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                "RoomGoblin uses Device Administrator only for managed display sleep and lock controls.");
            startActivityForResult(intent,REQUEST_ADMIN);
        }catch(Exception primary){
            try{
                Intent fallback=new Intent(Settings.ACTION_SECURITY_SETTINGS);
                startActivityForResult(fallback,REQUEST_ADMIN);
            }catch(Exception ignored){finish();}
        }
    }

    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){
        super.onActivityResult(requestCode,resultCode,data);
        if(requestCode==REQUEST_ADMIN)finish();
    }
}
