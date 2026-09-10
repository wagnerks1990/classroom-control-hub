package org.classroomhub.display;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;

final class RootTools {
    private RootTools() {}

    static boolean binaryDetected(){
        String[] paths={"/system/bin/su","/system/xbin/su","/sbin/su","/su/bin/su","/data/adb/magisk/busybox"};
        for(String p:paths)if(new File(p).exists())return true;
        return false;
    }

    static JSONObject probe(Context context) throws Exception {
        JSONObject o=new JSONObject();
        o.put("binaryDetected",binaryDetected());
        o.put("policyEnabled",HubStorage.prefs(context).getBoolean("allow_root_tools",false));
        Process p=null;
        try{
            p=new ProcessBuilder("su","-c","id").redirectErrorStream(true).start();
            String line=new BufferedReader(new InputStreamReader(p.getInputStream())).readLine();
            int rc=p.waitFor();
            boolean granted=rc==0&&line!=null&&line.contains("uid=0");
            o.put("granted",granted);o.put("output",line==null?"":line);o.put("exitCode",rc);
        }catch(Exception e){o.put("granted",false);o.put("error",String.valueOf(e.getMessage()));}
        finally{if(p!=null)p.destroy();}
        return o;
    }

    static JSONObject run(Context context,String command) throws Exception {
        SharedPreferences prefs=HubStorage.prefs(context);
        if(!prefs.getBoolean("allow_root_tools",false))throw new SecurityException("Root tools are disabled by Classroom Hub policy");
        if(command==null||command.trim().isEmpty()||command.length()>4096)throw new IllegalArgumentException("Invalid root command");
        Process p=new ProcessBuilder("su","-c",command).redirectErrorStream(true).start();
        BufferedReader reader=new BufferedReader(new InputStreamReader(p.getInputStream()));StringBuilder out=new StringBuilder();String line;
        while((line=reader.readLine())!=null&&out.length()<65536)out.append(line).append('\n');
        int rc=p.waitFor();JSONObject o=new JSONObject();o.put("ok",rc==0);o.put("exitCode",rc);o.put("output",out.toString());return o;
    }
}
