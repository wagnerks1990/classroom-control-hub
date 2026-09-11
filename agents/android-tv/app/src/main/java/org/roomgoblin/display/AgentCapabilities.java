package org.roomgoblin.display;

import android.Manifest;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import android.view.accessibility.AccessibilityManager;

import org.json.JSONObject;

final class AgentCapabilities {
    private AgentCapabilities() {}

    private static JSONObject cap(boolean available,String mode,String detail) throws Exception {
        JSONObject o=new JSONObject();o.put("available",available);o.put("mode",mode);o.put("detail",detail);return o;
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
            boolean rootBinary=RootTools.binaryDetected();
            JSONObject sendspin=NativeSendspinManager.INSTANCE.status(context);

            root.put("agentVersion",BuildConfig.VERSION_NAME);root.put("sdk",Build.VERSION.SDK_INT);root.put("manufacturer",Build.MANUFACTURER);root.put("model",Build.MODEL);root.put("device",Build.DEVICE);root.put("product",Build.PRODUCT);root.put("fingerprint",Build.FINGERPRINT);
            root.put("deviceOwner",deviceOwner);root.put("deviceAdminActive",adminActive);root.put("writeSecureSettings",secure);root.put("notificationPermission",notify);root.put("overlayPermission",overlay);root.put("writeSystemSettings",writeSettings);root.put("accessibilityEnabled",accessibilityEnabled);root.put("rootBinaryDetected",rootBinary);root.put("sendspin",sendspin);

            JSONObject c=new JSONObject();
            c.put("bootAutoStart",cap(true,"native","BOOT_COMPLETED/LOCKED_BOOT_COMPLETED receiver"));
            c.put("foregroundManagement",cap(true,"native","specialUse/mediaPlayback foreground service"));
            c.put("kioskAlwaysOn",cap(true,"native","agent process holds an always-on display wake lock while managed"));
            c.put("kioskSelfHeal",cap(true,"native","process-level watchdog requests kiosk relaunch within 30 seconds after the display activity leaves foreground"));
            c.put("agentHttpApi",cap(true,"native","authenticated LAN HTTP control channel independent of external ADB"));
            c.put("displayLaunch",cap(true,"native","launch own kiosk activity; watchdog retries background recovery when OEM policy delays a launch"));
            c.put("displayReload",cap(true,"native","reload own WebView without restarting native audio"));
            c.put("deviceHeartbeat",cap(true,"native","agent status/capability endpoint"));
            c.put("networkInfo",cap(true,"native","ConnectivityManager and local interface data"));
            c.put("nativeSendspin",cap(true,"native","Sendspin JVM transport with Android AudioTrack output; initial validated format target is PCM 48 kHz stereo 16-bit"));
            c.put("volumeControl",cap(true,"native","AudioManager media volume"));
            c.put("wakeDisplay",cap(true,"native","wake lock plus kiosk launch"));
            c.put("sleepDisplay",cap(adminActive,"device-admin","requires active device-admin force-lock policy; normally disabled for always-on kiosk profiles"));
            c.put("reboot",cap(deviceOwner,"device-owner","DevicePolicyManager.reboot requires device owner unless optional root tools are granted"));
            c.put("lockTaskKiosk",cap(deviceOwner,"device-owner","fully managed lock-task requires device-owner allowlisting"));
            c.put("persistentAdbSettings",cap(secure,"adb-bootstrap","WRITE_SECURE_SETTINGS must be granted once through trusted ADB, local ADB, or device-owner provisioning"));
            c.put("localAdbPairing",cap(true,"experimental","first-party local ADB client supports explicit pairing-code enrollment"));
            c.put("wirelessAdbDiscovery",cap(true,"experimental","first-party local ADB client uses Android mDNS discovery through libadb-android"));
            c.put("legacyAdbPortSwitch",cap(true,"experimental","local ADB can request tcpip:<target-port>; actual firmware behavior is measured at runtime"));
            c.put("localAdbSelfGrant",cap(true,"experimental","paired local ADB can attempt pm grant WRITE_SECURE_SETTINGS to this agent"));
            c.put("remoteShell",cap(rootBinary,"root-only","ordinary app sandbox cannot provide system shell; optional root tier can expose a gated root command channel"));
            c.put("rootProbe",cap(rootBinary,"experimental-root","explicit probe only; normal heartbeat never requests superuser"));
            c.put("globalNavigation",cap(accessibilityEnabled,"accessibility","Home/Back/Recents require optional accessibility service; Managed Displays can open the TV Accessibility settings"));
            c.put("launchOtherApps",cap(true,"limited","launchable packages only; Android package visibility applies"));
            c.put("installedAppInventory",cap(true,"limited","launcher-visible apps by default; broader inventory requires package-query/elevated management"));
            c.put("screenCapture",cap(false,"user-consent","full-screen capture requires MediaProjection consent; ADB/root may offer unattended alternatives"));
            c.put("ownDisplaySnapshot",cap(true,"planned","own WebView can be rendered without MediaProjection"));
            c.put("silentApkInstall",cap(deviceOwner||rootBinary,"elevated","device-owner or optional root tier required for unattended install"));
            c.put("interactiveApkInstall",cap(true,"native","PackageInstaller can request user-confirmed installation"));
            c.put("selfUpdate",cap(deviceOwner||rootBinary,"mixed","silent only with elevated management; otherwise user-confirmed installer flow"));
            c.put("powerOff",cap(rootBinary,"root-only","ordinary Android apps cannot power off the device"));
            c.put("inputInjection",cap(accessibilityEnabled||rootBinary,"elevated","accessibility handles global navigation; arbitrary input injection needs shell/root/system privilege"));
            c.put("systemSettingsWrite",cap(secure||writeSettings||rootBinary,"permission-dependent","secure/global settings need WRITE_SECURE_SETTINGS or elevated privilege"));
            c.put("overlay",cap(overlay,"user-grant","SYSTEM_ALERT_WINDOW requires explicit approval"));
            c.put("deviceAdmin",cap(adminActive,"user-grant","legacy device-admin can lock but is not equivalent to device owner"));
            c.put("deviceOwnerProvisioning",cap(deviceOwner,"provisioning","normally requires provisioning/factory-reset workflow on consumer Android TV"));
            c.put("mediaProjectionApi",cap(context.getSystemService(Context.MEDIA_PROJECTION_SERVICE)!=null,"user-consent","API present but each capture session requires platform-granted consent"));
            c.put("accessibilityApi",cap(accessibility!=null,"user-grant","service must be explicitly enabled unless provisioned by management tooling"));
            root.put("capabilities",c);
        } catch(Exception e) {try {root.put("probeError",String.valueOf(e));}catch(Exception ignored){}}
        return root;
    }
}
