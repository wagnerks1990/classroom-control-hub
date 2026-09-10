package org.classroomhub.display;

import android.accessibilityservice.AccessibilityService;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.media.AudioManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class AgentService extends Service {
    private static final String TAG="ClassroomHubAgentV2";
    private static final String CHANNEL="classroom_hub_agent";
    private static final int NOTIFICATION_ID=2202;
    private static final int DEFAULT_PORT=8765;
    private volatile boolean stopping=false;
    private ServerSocket server;
    private final ExecutorService workers=Executors.newCachedThreadPool();

    public static void start(Context context){
        Intent i=new Intent(context,AgentService.class);
        try{if(Build.VERSION.SDK_INT>=26)context.startForegroundService(i);else context.startService(i);}catch(Exception e){Log.w(TAG,"Unable to start management service",e);}
    }

    @Override public void onCreate(){super.onCreate();createNotificationChannel();Notification n=buildNotification();if(Build.VERSION.SDK_INT>=29){try{startForeground(NOTIFICATION_ID,n,ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);}catch(Throwable ignored){startForeground(NOTIFICATION_ID,n);}}else startForeground(NOTIFICATION_ID,n);startServer();}
    @Override public int onStartCommand(Intent intent,int flags,int startId){enforcePersistentAdbSettings("service-start");return START_STICKY;}
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public void onDestroy(){stopping=true;try{if(server!=null)server.close();}catch(Exception ignored){}workers.shutdownNow();super.onDestroy();}

    private void createNotificationChannel(){if(Build.VERSION.SDK_INT<26)return;NotificationManager nm=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);if(nm==null)return;NotificationChannel c=new NotificationChannel(CHANNEL,"Classroom Hub device management",NotificationManager.IMPORTANCE_LOW);c.setDescription("Keeps the classroom display connected to Classroom Hub management.");nm.createNotificationChannel(c);}
    private Notification buildNotification(){Intent open=new Intent(this,MainActivity.class);PendingIntent pi=PendingIntent.getActivity(this,0,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);Notification.Builder b=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,CHANNEL):new Notification.Builder(this);return b.setSmallIcon(android.R.drawable.stat_notify_sync).setContentTitle("Classroom Hub display managed").setContentText("Device Agent v2 is running").setOngoing(true).setContentIntent(pi).build();}

    private void startServer(){SharedPreferences p=HubStorage.prefs(this);if(!p.getBoolean("agent_enabled",true))return;final int port=Math.max(1024,Math.min(65535,p.getInt("agent_port",DEFAULT_PORT)));workers.execute(()->{try{server=new ServerSocket(port,16,InetAddress.getByName("0.0.0.0"));Log.i(TAG,"Agent v2 HTTP management listening on "+port);while(!stopping){Socket socket=server.accept();socket.setSoTimeout(10000);workers.execute(()->handle(socket));}}catch(Exception e){if(!stopping)Log.e(TAG,"Agent management listener failed",e);}});}

    private void handle(Socket socket){try(Socket s=socket;BufferedInputStream in=new BufferedInputStream(s.getInputStream());BufferedOutputStream out=new BufferedOutputStream(s.getOutputStream())){String requestLine=readLine(in);if(requestLine==null||requestLine.isEmpty())return;String[] first=requestLine.split(" ",3);if(first.length<2){writeJson(out,400,error("bad_request","Malformed request"));return;}String method=first[0].toUpperCase(Locale.ROOT),path=first[1];int contentLength=0;String token="";for(;;){String line=readLine(in);if(line==null||line.isEmpty())break;int colon=line.indexOf(':');if(colon<1)continue;String name=line.substring(0,colon).trim().toLowerCase(Locale.ROOT),value=line.substring(colon+1).trim();if("content-length".equals(name))try{contentLength=Math.min(65536,Integer.parseInt(value));}catch(Exception ignored){}if("x-classroom-hub-agent-token".equals(name))token=value;}if(!authorized(token)){writeJson(out,401,error("unauthorized","Valid device-agent token required"));return;}byte[] body=contentLength>0?readExact(in,contentLength):new byte[0];JSONObject input=body.length>0?new JSONObject(new String(body,StandardCharsets.UTF_8)):new JSONObject();if("GET".equals(method)&&"/v1/status".equals(path)){writeJson(out,200,status());return;}if("GET".equals(method)&&"/v1/capabilities".equals(path)){writeJson(out,200,AgentCapabilities.snapshot(this));return;}if("POST".equals(method)&&"/v1/action".equals(path)){JSONObject result=action(input);writeJson(out,result.optBoolean("ok",true)?200:409,result);return;}writeJson(out,404,error("not_found","Unknown agent endpoint"));}catch(Exception e){Log.w(TAG,"Agent request failed",e);}}

    private boolean authorized(String supplied){String expected=HubStorage.prefs(this).getString("agent_token","");if(expected==null||expected.length()<32||supplied==null)return false;return MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),supplied.getBytes(StandardCharsets.UTF_8));}
    private JSONObject status() throws Exception {SharedPreferences p=HubStorage.prefs(this);JSONObject o=new JSONObject();o.put("ok",true);o.put("agentVersion",BuildConfig.VERSION_NAME);o.put("package",getPackageName());o.put("displayUrl",p.getString("display_url",""));o.put("agentPort",p.getInt("agent_port",DEFAULT_PORT));o.put("persistentAdb",p.getBoolean("persistent_adb",false));o.put("targetAdbPort",p.getInt("target_adb_port",5555));o.put("uptimeMs",android.os.SystemClock.elapsedRealtime());o.put("network",networkInfo());o.put("capabilities",AgentCapabilities.snapshot(this).optJSONObject("capabilities"));return o;}
    private JSONObject networkInfo() throws Exception {JSONObject o=new JSONObject();ConnectivityManager cm=(ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE);Network active=cm==null?null:cm.getActiveNetwork();NetworkCapabilities nc=cm==null||active==null?null:cm.getNetworkCapabilities(active);o.put("connected",nc!=null&&nc.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET));o.put("wifi",nc!=null&&nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI));o.put("ethernet",nc!=null&&nc.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET));StringBuilder addresses=new StringBuilder();for(NetworkInterface ni:Collections.list(NetworkInterface.getNetworkInterfaces()))for(InetAddress a:Collections.list(ni.getInetAddresses()))if(!a.isLoopbackAddress()){if(addresses.length()>0)addresses.append(',');addresses.append(a.getHostAddress());}o.put("addresses",addresses.toString());return o;}

    private JSONObject action(JSONObject input) throws Exception {String name=input.optString("action","");JSONObject result=new JSONObject();result.put("ok",true);result.put("action",name);switch(name){
        case "launch":MainActivity.launch(this,false);result.put("accepted",true);break;
        case "reload":MainActivity.launch(this,true);result.put("accepted",true);break;
        case "wake":wake();MainActivity.launch(this,false);result.put("accepted",true);break;
        case "volume":result.put("volume",setVolume(input.optInt("percent",35)));break;
        case "home":result.put("performed",AgentAccessibilityService.perform(AccessibilityService.GLOBAL_ACTION_HOME));break;
        case "back":result.put("performed",AgentAccessibilityService.perform(AccessibilityService.GLOBAL_ACTION_BACK));break;
        case "recents":result.put("performed",AgentAccessibilityService.perform(AccessibilityService.GLOBAL_ACTION_RECENTS));break;
        case "sleep":result.put("performed",sleep());break;
        case "reboot":result.put("performed",reboot());break;
        case "recover-adb-settings":result.put("performed",enforcePersistentAdbSettings("remote-action"));break;
        case "capabilities":result.put("capabilities",AgentCapabilities.snapshot(this));break;
        case "local-adb-pair":result.put("result",localAdbPair(input));break;
        case "local-adb-connect":result.put("result",localAdbConnect(input));break;
        case "local-adb-self-grant":result.put("result",localAdbSelfGrant(input));break;
        case "local-adb-switch-port":result.put("result",localAdbSwitchPort(input));break;
        case "root-probe":result.put("result",RootTools.probe(this));break;
        case "root-command":result.put("result",RootTools.run(this,input.optString("command","")));break;
        default:return error("unsupported_action","Unsupported or intentionally blocked action: "+name);
    }return result;}

    private JSONObject localAdbPair(JSONObject input) throws Exception {int port=input.optInt("port",0);String code=input.optString("code","").trim();if(port<1024||port>65535||!code.matches("\\d{6}"))throw new IllegalArgumentException("Pairing port and six-digit code are required");try(LocalAdbManager m=new LocalAdbManager(this)){JSONObject o=new JSONObject();o.put("paired",m.pairLocal(port,code));return o;}}
    private JSONObject localAdbConnect(JSONObject input) throws Exception {long timeout=Math.max(1000,Math.min(30000,input.optLong("timeoutMs",12000)));try(LocalAdbManager m=new LocalAdbManager(this)){JSONObject o=new JSONObject();o.put("connected",m.discoverAndConnect(this,timeout));return o;}}
    private JSONObject localAdbSelfGrant(JSONObject input) throws Exception {long timeout=Math.max(1000,Math.min(30000,input.optLong("timeoutMs",12000)));try(LocalAdbManager m=new LocalAdbManager(this)){boolean connected=m.discoverAndConnect(this,timeout);String output=connected?m.shell("pm grant "+getPackageName()+" android.permission.WRITE_SECURE_SETTINGS"):"";JSONObject o=new JSONObject();o.put("connected",connected);o.put("granted",checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS")==android.content.pm.PackageManager.PERMISSION_GRANTED);o.put("output",output);return o;}}
    private JSONObject localAdbSwitchPort(JSONObject input) throws Exception {int port=Math.max(1024,Math.min(65535,input.optInt("port",HubStorage.prefs(this).getInt("target_adb_port",5555))));long timeout=Math.max(1000,Math.min(30000,input.optLong("timeoutMs",12000)));try(LocalAdbManager m=new LocalAdbManager(this)){boolean connected=m.discoverAndConnect(this,timeout);String output=connected?m.switchTcpPort(port):"";JSONObject o=new JSONObject();o.put("connected",connected);o.put("targetPort",port);o.put("output",output);return o;}}

    private int setVolume(int percent){AudioManager am=(AudioManager)getSystemService(AUDIO_SERVICE);if(am==null)return -1;int max=am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);int value=Math.max(0,Math.min(max,Math.round(max*Math.max(0,Math.min(100,percent))/100f)));am.setStreamVolume(AudioManager.STREAM_MUSIC,value,0);return max==0?0:Math.round(value*100f/max);}
    private void wake(){PowerManager pm=(PowerManager)getSystemService(POWER_SERVICE);if(pm==null)return;PowerManager.WakeLock lock=pm.newWakeLock(PowerManager.FULL_WAKE_LOCK|PowerManager.ACQUIRE_CAUSES_WAKEUP|PowerManager.ON_AFTER_RELEASE,"classroomhub:agent-wake");try{lock.acquire(5000);}finally{if(lock.isHeld())lock.release();}}
    private boolean sleep(){DevicePolicyManager dpm=(DevicePolicyManager)getSystemService(DEVICE_POLICY_SERVICE);ComponentName admin=new ComponentName(this,AgentDeviceAdminReceiver.class);if(dpm==null||!dpm.isAdminActive(admin))return false;try{dpm.lockNow();return true;}catch(Exception e){return false;}}
    private boolean reboot(){DevicePolicyManager dpm=(DevicePolicyManager)getSystemService(DEVICE_POLICY_SERVICE);if(dpm==null||!dpm.isDeviceOwnerApp(getPackageName()))return false;try{dpm.reboot(new ComponentName(this,AgentDeviceAdminReceiver.class));return true;}catch(Exception e){return false;}}
    private boolean enforcePersistentAdbSettings(String source){SharedPreferences p=HubStorage.prefs(this);if(!p.getBoolean("persistent_adb",false))return false;try{Settings.Global.putInt(getContentResolver(),"development_settings_enabled",1);Settings.Global.putInt(getContentResolver(),"adb_wifi_enabled",1);Log.i(TAG,"ADB settings policy applied from "+source);return true;}catch(Exception e){Log.w(TAG,"ADB settings recovery unavailable from "+source,e);return false;}}
    private static JSONObject error(String code,String message){JSONObject o=new JSONObject();try{o.put("ok",false);o.put("code",code);o.put("error",message);}catch(Exception ignored){}return o;}
    private static String readLine(BufferedInputStream in) throws Exception {ByteArrayOutputStream b=new ByteArrayOutputStream();int prev=-1;for(int i=0;i<8192;i++){int c=in.read();if(c<0)return b.size()==0?null:b.toString("UTF-8");if(prev=='\r'&&c=='\n'){byte[] raw=b.toByteArray();return new String(raw,0,Math.max(0,raw.length-1),StandardCharsets.UTF_8);}b.write(c);prev=c;}throw new IllegalArgumentException("Header line too long");}
    private static byte[] readExact(BufferedInputStream in,int count) throws Exception {byte[] b=new byte[count];int off=0;while(off<count){int n=in.read(b,off,count-off);if(n<0)throw new EOFException();off+=n;}return b;}
    private static void writeJson(BufferedOutputStream out,int status,JSONObject body) throws Exception {byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8);String head="HTTP/1.1 "+status+" "+(status<400?"OK":"Error")+"\r\nContent-Type: application/json\r\nContent-Length: "+bytes.length+"\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n";out.write(head.getBytes(StandardCharsets.UTF_8));out.write(bytes);out.flush();}
}
