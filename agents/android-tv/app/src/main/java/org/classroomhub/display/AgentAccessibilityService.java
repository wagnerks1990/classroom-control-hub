package org.classroomhub.display;

import android.accessibilityservice.AccessibilityService;
import android.content.ComponentName;
import android.content.Context;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.accessibility.AccessibilityEvent;

public class AgentAccessibilityService extends AccessibilityService {
    private static volatile AgentAccessibilityService instance;

    @Override protected void onServiceConnected(){ instance=this; }
    @Override public void onAccessibilityEvent(AccessibilityEvent event) {}
    @Override public void onInterrupt() {}
    @Override public void onDestroy(){ if(instance==this)instance=null; super.onDestroy(); }

    static boolean isEnabled(Context context){
        String enabled=Settings.Secure.getString(context.getContentResolver(),Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if(TextUtils.isEmpty(enabled))return false;
        ComponentName me=new ComponentName(context,AgentAccessibilityService.class);
        for(String value:enabled.split(":")){
            ComponentName c=ComponentName.unflattenFromString(value);
            if(me.equals(c))return true;
        }
        return false;
    }

    static boolean perform(int action){
        AgentAccessibilityService service=instance;
        return service!=null&&service.performGlobalAction(action);
    }
}
