package org.roomgoblin.display;

import android.content.Context;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.math.BigInteger;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.Certificate;
import java.util.Calendar;
import java.util.Date;

import javax.security.auth.x500.X500Principal;

import io.github.muntashirakon.adb.AbsAdbConnectionManager;
import io.github.muntashirakon.adb.AdbStream;

final class LocalAdbManager extends AbsAdbConnectionManager {
    private static final String KEYSTORE="AndroidKeyStore";
    private static final String ALIAS="classroom_hub_local_adb_v2";
    private final PrivateKey privateKey;
    private final Certificate certificate;

    LocalAdbManager(Context context) throws Exception {
        setApi(Build.VERSION.SDK_INT);
        setHostAddress("127.0.0.1");
        KeyStore ks=KeyStore.getInstance(KEYSTORE);ks.load(null);
        if(!ks.containsAlias(ALIAS))generateKey();
        KeyStore.PrivateKeyEntry entry=(KeyStore.PrivateKeyEntry)ks.getEntry(ALIAS,null);
        if(entry==null)throw new IllegalStateException("Unable to load local ADB key");
        privateKey=entry.getPrivateKey();certificate=entry.getCertificate();
    }

    private static void generateKey() throws Exception {
        Calendar start=Calendar.getInstance();start.add(Calendar.DAY_OF_YEAR,-1);
        Calendar end=Calendar.getInstance();end.add(Calendar.YEAR,20);
        KeyPairGenerator generator=KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA,KEYSTORE);
        KeyGenParameterSpec spec=new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_SIGN|KeyProperties.PURPOSE_VERIFY)
            .setKeySize(2048)
            .setDigests(KeyProperties.DIGEST_SHA256,KeyProperties.DIGEST_SHA512)
            .setSignaturePaddings(KeyProperties.SIGNATURE_PADDING_RSA_PKCS1)
            .setCertificateSubject(new X500Principal("CN=RoomGoblin Device Agent"))
            .setCertificateSerialNumber(BigInteger.valueOf(System.currentTimeMillis()))
            .setCertificateNotBefore(start.getTime())
            .setCertificateNotAfter(end.getTime())
            .build();
        generator.initialize(spec);generator.generateKeyPair();
    }

    @Override protected PrivateKey getPrivateKey(){return privateKey;}
    @Override protected Certificate getCertificate(){return certificate;}
    @Override protected String getDeviceName(){return "RoomGoblinDeviceAgent";}

    boolean pairLocal(int port,String code) throws Exception {return pair("127.0.0.1",port,code);}
    boolean discoverAndConnect(Context context,long timeoutMs) throws Exception {return autoConnect(context,timeoutMs)||isConnected();}
    boolean connectLocal(int port) throws Exception {return connect("127.0.0.1",port)||isConnected();}

    String shell(String command) throws Exception {return read(openStream("shell:"+command));}
    String switchTcpPort(int targetPort) throws Exception {return read(openStream("tcpip:"+targetPort));}

    private static String read(AdbStream stream) throws Exception {
        try(AdbStream s=stream; InputStream in=s.openInputStream(); ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] buf=new byte[2048];int n;
            try{while((n=in.read(buf))>=0){if(n>0)out.write(buf,0,n);if(out.size()>1024*1024)break;}}catch(Exception ignored){}
            return out.toString("UTF-8");
        }
    }
}
