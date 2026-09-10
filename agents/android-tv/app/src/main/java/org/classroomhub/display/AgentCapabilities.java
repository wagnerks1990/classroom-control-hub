package org.classroomhub.display;

import android.Manifest;
import android.app.ActivityManager;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.provider.Settings;
import android.view.accessibility.AccessibilityManager;

import org.json.JSONObject;

final class AgentCapabilities {
    private AgentCapabilities() {}

    private static JSONObject cap(boolean available,String mode,String detail) throws Exception {
        JSONObject o=new JSONObject();
        o.put("available",available);
        o.put("mode",mode);
        o.put("detail",detail);
        return o;
    }

    static JSONObject snapshot(Context context) {
        JSONObject root=new JSONObject();
        try {
            PackageManager pm=context.getPackageManager();
            DevicePolicyManager dpm=(DevicePolicyManager)context.getSystemService(Context.DEVICE_POLICY_SERVICE);
            ComponentName admin=new ComponentName(context,AgentDeviceAdminReceiver.class);
            AccessibilityManager accessibility=(AccessibilityManager)context.getSystemService(Context.ACCESSIBILITY_SERVICE);
            boolean deviceOwner=dpm!=null&&dpm.isDeviceOwnerApp(context.getPackageName());
            boolean adminActive=dpm!=null&&dpm.isAdminActive(admin);
            boolean secure=context.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS")==PackageManager.PERMISSION_GRANTED;
            boolean notify=Build.VERSION.SDK_INT<33||context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED;
            boolean overlay=Settings.canDrawOverlays(context);
            boolean writeSettings=Settings.System.canWrite(context);
            boolean accessibilityEnabled=AgentAccessibilityService.isEnabled(context);

            root.put("agentVersion",BuildConfig.VERSION_NAME);
            root.put("sdk",Build.VERSION.SDK_INT);
            root.put("manufacturer",Build.MANUFACTURER);
            root.put("model",Build.MODEL);
            root.put("device",Build.DEVICE);
            root.put("product",Build.PRODUCT);
            root.put("fingerprint",Build.FINGERPRINT);
            root.put("deviceOwner",deviceOwner);
            root.put("deviceAdminActive",adminActive);
            root.put("writeSecureSettings",secure);
            root.put("notificationPermission",notify);
            root.put("overlayPermission",overlay);
            root.put("writeSystemSettings",writeSettings);
            root.put("accessibilityEnabled",accessibilityEnabled);

            JSONObject c=new JSONObject();
            c.put("bootAutoStart",cap(true,"native","BOOT_COMPLETED/LOCKED_BOOT_COMPLETED receiver"));
            c.put("foregroundManagement",cap(true,"native","specialUse foreground service"));
            c.put("agentHttpApi",cap(true,"native","authenticated LAN HTTP control channel"));
            c.put("displayLaunch",cap(true,"native","launch own kiosk activity; background launch remains OEM-policy dependent"));
            c.put("displayReload",cap(true,"native","reload own WebView"));
            c.put("deviceHeartbeat",cap(true,"native","agent status/capability endpoint"));
            c.put("networkInfo",cap(true,"native","ConnectivityManager and local interface data"));
            c.put("volumeControl",cap(true,"native","AudioManager media volume"));
            c.put("wakeDisplay",cap(true,"native","short wake lock plus kiosk launch"));
            c.put("sleepDisplay",cap(adminActive,"device-admin","requires active device-admin force-lock policy"));
            c.put("reboot",cap(deviceOwner,"device-owner","DevicePolicyManager.reboot requires device owner"));
            c.put("lockTaskKiosk",cap(deviceOwner,"device-owner","fully managed lock-task requires device owner allowlisting"));
            c.put("persistentAdbSettings",cap(secure,"adb-bootstrap","WRITE_SECURE_SETTINGS must be granted once through trusted ADB/device-owner provisioning"));
            c.put("wirelessAdbDiscovery",cap(false,"planned","on-device ADB TLS/mDNS client not yet embedded in this first v2 slice"));
            c.put("remoteShell",cap(false,"platform-blocked","ordinary Android apps cannot provide arbitrary system shell privileges"));
            c.put("globalNavigation",cap(accessibilityEnabled,"accessibility","Home/Back/Recents require the optional accessibility service"));
            c.put("launchOtherApps",cap(true,"limited","launchable packages only; Android package visibility applies"));
            c.put("installedAppInventory",cap(true,"limited","launcher-visible apps only unless elevated/package-query privileges are granted"));
            c.put("screenCapture",cap(false,"user-consent","full-screen capture requires MediaProjection user consent; ADB remains preferred unattended path"));
            c.put("ownDisplaySnapshot",cap(true,"planned","own WebView can be rendered without MediaProjection; implementation follows after management transport validation"));
            c.put("silentApkInstall",cap(deviceOwner,"device-owner","silent package install is reserved for managed/device-owner scenarios"));
            c.put("interactiveApkInstall",cap(true,"native","PackageInstaller can request user-confirmed installation"));
            c.put("selfUpdate",cap(deviceOwner,"mixed","silent with device-owner provisioning; otherwise user-confirmed package installer flow"));
            c.put("powerOff",cap(false,"platform-blocked","ordinary apps cannot power off Android TV"));
            c.put("inputInjection",cap(accessibilityEnabled,"accessibility-limited","global navigation possible through accessibility; arbitrary key injection is signature/system restricted"));
            c.put("systemSettingsWrite",cap(secure||writeSettings,"permission-dependent","secure/global settings need WRITE_SECURE_SETTINGS; ordinary system settings need ACTION_MANAGE_WRITE_SETTINGS approval"));
            c.put("overlay",cap(overlay,"user-grant","SYSTEM_ALERT_WINDOW requires explicit user approval"));
            c.put("deviceAdmin",cap(adminActive,"user-grant","legacy device-admin can lock but is not equivalent to device owner"));
            c.put("deviceOwnerProvisioning",cap(deviceOwner,"provisioning","normally requires provisioning/factory-reset workflow on consumer Android TV"));
            c.put("mediaProjectionApi",cap(context.getSystemService(Context.MEDIA_PROJECTION_SERVICE)!=null,"user-consent","API present but every capture session requires platform-granted consent"));
            c.put("accessibilityApi",cap(accessibility!=null,"user-grant","service must be explicitly enabled unless provisioned by management tooling"));
            root.put("capabilities",c);
        } catch(Exception e) {
            try { root.put("probeError",String.valueOf(e)); } catch(Exception ignored) {}
        }
        return root;
    }
}
