package org.classroomhub.display;

import android.content.Context;
import android.os.PowerManager;
import android.util.Log;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Process-level kiosk watchdog owned by the foreground AgentService.
 * It is intentionally independent of MainActivity so leaving/killing the WebView cannot stop recovery.
 */
final class KioskWatchdog {
    private static final String TAG="ClassroomHubKiosk";
    private static final long CHECK_SECONDS=10;
    private static final long RELAUNCH_AFTER_MS=20_000L;
    private static final AtomicBoolean started=new AtomicBoolean(false);
    private static ScheduledExecutorService scheduler;
    private static PowerManager.WakeLock screenLock;
    private static volatile boolean displayResumed=false;
    private static volatile long leftDisplayAt=0L;

    private KioskWatchdog(){}

    static void markDisplayResumed(){displayResumed=true;leftDisplayAt=0L;}
    static void markDisplayPaused(){displayResumed=false;if(leftDisplayAt==0L)leftDisplayAt=android.os.SystemClock.elapsedRealtime();}

    static synchronized void start(Context context){
        if(started.get())return;
        started.set(true);
        Context app=context.getApplicationContext();
        try{
            PowerManager pm=(PowerManager)app.getSystemService(Context.POWER_SERVICE);
            if(pm!=null){
                screenLock=pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK|PowerManager.ACQUIRE_CAUSES_WAKEUP|PowerManager.ON_AFTER_RELEASE,"classroomhub:kiosk-always-on");
                screenLock.setReferenceCounted(false);
                screenLock.acquire();
            }
        }catch(Exception e){Log.w(TAG,"Unable to acquire always-on display wake lock",e);}
        scheduler=Executors.newSingleThreadScheduledExecutor(r->{Thread t=new Thread(r,"ClassroomHub-Kiosk-Watchdog");t.setDaemon(true);return t;});
        scheduler.scheduleWithFixedDelay(()->tick(app),5,CHECK_SECONDS,TimeUnit.SECONDS);
        Log.i(TAG,"Always-on kiosk watchdog started; recovery target <=30 seconds");
    }

    private static void tick(Context context){
        try{
            NativeSendspinManager.INSTANCE.ensureStarted(context);
            if(displayResumed)return;
            long now=android.os.SystemClock.elapsedRealtime();
            if(leftDisplayAt==0L)leftDisplayAt=now;
            if(now-leftDisplayAt<RELAUNCH_AFTER_MS)return;
            Log.w(TAG,"Kiosk not foreground; requesting recovery launch");
            MainActivity.launch(context,false);
            // Retry every watchdog cycle until onResume proves the activity is back.
            leftDisplayAt=now;
        }catch(Exception e){Log.w(TAG,"Kiosk watchdog tick failed",e);}
    }

    static synchronized void stop(){
        started.set(false);
        if(scheduler!=null){scheduler.shutdownNow();scheduler=null;}
        try{if(screenLock!=null&&screenLock.isHeld())screenLock.release();}catch(Exception ignored){}
        screenLock=null;
    }
}
