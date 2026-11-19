package com.coollamp.controller;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.view.Window;
import android.view.WindowManager;
import androidx.lifecycle.Lifecycle;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.spec.ECGenParameterSpec;
import java.util.*;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

@CapacitorPlugin(name="LampNetwork")
public class LampNetworkPlugin extends Plugin {
    private static final String HOME_IDENTITY_ALIAS="coollamp-home-installation-v1";
    private static final String HOME_IDENTITY_PREFERENCES="coollamp-home-installation-v1";
    private static final String HOME_IDENTITY_RECORD="identity";
    private static final String HOME_IDENTITY_RECOVERY="This phone's Home access identity needs recovery.";
    private static final Object HOME_IDENTITY_LOCK=new Object();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private int generation = 0;
    private NsdManager.DiscoveryListener discovery;
    private final ArrayDeque<NsdServiceInfo> queue = new ArrayDeque<>();
    private final Map<String, JSObject> found = new LinkedHashMap<>();
    private boolean resolving = false;
    private PluginCall pending;
    private NsdManager manager;
    private static String firmwareScreenToken;
    private static boolean firmwareScreenPrevious;
    private static Window firmwareScreenWindow;
    private String firmwareScreenOwnedToken;
    private boolean firmwareScreenDestroyed;

    @PluginMethod public void setFirmwareScreenAwake(PluginCall call) {
        String token=call.getString("token"); Boolean enabled=call.getBoolean("enabled");
        if(token==null || !token.matches("[a-f0-9]{32}") || enabled==null){call.reject("Invalid firmware screen lease.");return;}
        handler.post(() -> {
            if(enabled){
                if(firmwareScreenDestroyed || getActivity()==null || getActivity().isFinishing() || getActivity().isDestroyed() ||
                   !getActivity().getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED)){
                    call.reject("Keep the app in the foreground to update through Bluetooth.");return;
                }
                if(firmwareScreenToken!=null && !firmwareScreenToken.equals(token)){
                    call.reject("Another firmware transfer already holds the screen awake.");return;
                }
                if(firmwareScreenToken==null){
                    Window window=getActivity().getWindow();
                    firmwareScreenPrevious=(window.getAttributes().flags & WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)!=0;
                    firmwareScreenWindow=window;firmwareScreenToken=token;
                    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
                firmwareScreenOwnedToken=token;
            }else{
                restoreFirmwareScreenToken(token);
                if(token.equals(firmwareScreenOwnedToken))firmwareScreenOwnedToken=null;
            }
            JSObject result=new JSObject();result.put("active",firmwareScreenToken!=null);call.resolve(result);
        });
    }

    private static void restoreFirmwareScreenToken(String token) {
        if(token==null || !token.equals(firmwareScreenToken))return;
        Window window=firmwareScreenWindow;boolean previous=firmwareScreenPrevious;
        firmwareScreenToken=null;firmwareScreenWindow=null;
        if(window!=null){
            if(previous)window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
    }
    private void restoreFirmwareScreen() {
        String token=firmwareScreenOwnedToken;firmwareScreenOwnedToken=null;
        restoreFirmwareScreenToken(token);
    }
    private void firmwareUi(Runnable action) {
        if(Looper.myLooper()==Looper.getMainLooper())action.run();else handler.post(action);
    }
    @Override protected void handleOnPause(){super.handleOnPause();firmwareUi(this::restoreFirmwareScreen);}

    @PluginMethod public void firmwareDigest(PluginCall call) {
        String encoded=call.getString("data");
        if(encoded==null || encoded.length()>2708824){call.reject("Invalid firmware image.");return;}
        getBridge().execute(() -> {
            try {
                byte[] bytes=Base64.decode(encoded,Base64.NO_WRAP);
                if(bytes.length<288 || bytes.length>2031616){call.reject("Invalid firmware image.");return;}
                byte[] digest=MessageDigest.getInstance("SHA-256").digest(bytes);
                StringBuilder hex=new StringBuilder(64);
                for(byte value:digest)hex.append(String.format(Locale.ROOT,"%02x",value & 255));
                JSObject result=new JSObject();result.put("sha256",hex.toString());call.resolve(result);
            }catch(Exception error){call.reject("Could not verify firmware image.");}
        });
    }

    @PluginMethod public void discover(PluginCall call) {
        handler.post(() -> {
            if(pending != null) { call.reject("Discovery is already running."); return; }
            pending=call; found.clear(); queue.clear(); resolving=false;
            final int epoch=++generation;
            manager=(NsdManager)getContext().getSystemService(Context.NSD_SERVICE);
            discovery=new NsdManager.DiscoveryListener() {
                public void onDiscoveryStarted(String t) {}
                public void onDiscoveryStopped(String t) {}
                public void onStopDiscoveryFailed(String t,int e) {}
                public void onStartDiscoveryFailed(String t,int e) { handler.post(()->{if(epoch==generation)finish("Could not search the local network. Check network permissions.");}); }
                public void onServiceLost(NsdServiceInfo s) {}
                public void onServiceFound(NsdServiceInfo s) { handler.post(()->{if(epoch==generation && queue.size()<64){queue.add(s);resolveNext(epoch);}}); }
            };
            try { manager.discoverServices("_coollamp._tcp.",NsdManager.PROTOCOL_DNS_SD,discovery); }
            catch(Exception e) { finish("Could not start network discovery. Check network permissions."); return; }
            handler.postDelayed(()->{if(epoch==generation)finish(null);},8000);
        });
    }
    @SuppressWarnings("deprecation") private void resolveNext(int epoch) {
        if(epoch!=generation || resolving || queue.isEmpty())return;
        resolving=true;
        try { manager.resolveService(queue.remove(),new NsdManager.ResolveListener(){
            public void onResolveFailed(NsdServiceInfo s,int e){handler.post(()->{if(epoch==generation){resolving=false;resolveNext(epoch);}});}
            public void onServiceResolved(NsdServiceInfo s){handler.post(()->{
                if(epoch!=generation)return;
                byte[] id=s.getAttributes().get("id"), name=s.getAttributes().get("name");
                if(id!=null && s.getHost()!=null && s.getPort()==80){
                    String identity=new String(id,StandardCharsets.UTF_8);
                    String address=s.getHost().getHostAddress();
                    if(address!=null && !address.contains(":")) {
                        JSObject item=new JSObject();item.put("id",identity);item.put("name",name==null?s.getServiceName():new String(name,StandardCharsets.UTF_8));item.put("address","http://"+address);found.put(identity,item);
                    }
                }
                resolving=false;resolveNext(epoch);
            });}
        }); } catch(Exception e) { resolving=false;resolveNext(epoch); }
    }
    private void finish(String error) {
        ++generation;
        if(manager!=null && discovery!=null)try{manager.stopServiceDiscovery(discovery);}catch(Exception ignored){}
        discovery=null;queue.clear();resolving=false;
        PluginCall call=pending;pending=null;
        if(call==null)return;
        if(error!=null){call.reject(error);return;}
        JSArray lamps=new JSArray();for(JSObject item:found.values())lamps.put(item);
        JSObject result=new JSObject();result.put("lamps",lamps);call.resolve(result);
    }
    @Override protected void handleOnDestroy(){
        super.handleOnDestroy();
        firmwareUi(()->{firmwareScreenDestroyed=true;restoreFirmwareScreen();finish("Discovery stopped.");});
    }

    private static String lowerHex(byte[] value) {
        StringBuilder result=new StringBuilder(value.length*2);
        for(byte item:value)result.append(String.format(Locale.ROOT,"%02x",item & 255));
        return result.toString();
    }
    private static String randomOpaqueId(SecureRandom random) throws Exception {
        for(int attempt=0;attempt<4;attempt++){
            byte[] value=new byte[16];random.nextBytes(value);String result=lowerHex(value);
            if(!result.equals("00000000000000000000000000000000"))return result;
        }
        throw new Exception(HOME_IDENTITY_RECOVERY);
    }
    private static String requiredString(JSONObject value,String key) throws Exception {
        Object item=value.opt(key);if(!(item instanceof String))throw new Exception(HOME_IDENTITY_RECOVERY);return (String)item;
    }
    private static int requiredInteger(JSONObject value,String key) throws Exception {
        Object item=value.opt(key);if(!(item instanceof Number))throw new Exception(HOME_IDENTITY_RECOVERY);
        Number number=(Number)item;int result=number.intValue();
        if(!Double.isFinite(number.doubleValue()) || number.doubleValue()!=result)throw new Exception(HOME_IDENTITY_RECOVERY);return result;
    }
    private static JSObject verifiedHomeIdentity(JSONObject metadata,KeyStore store) throws Exception {
        if(metadata.length()!=7 || requiredInteger(metadata,"version")!=1 || requiredInteger(metadata,"credentialGeneration")!=1)
            throw new Exception(HOME_IDENTITY_RECOVERY);
        String installationId=requiredString(metadata,"installationId"),credentialKeyId=requiredString(metadata,"credentialKeyId"),
            displayName=requiredString(metadata,"displayName"),thumbprint=requiredString(metadata,"publicKeyThumbprint"),keyState=requiredString(metadata,"keyState");
        if(!installationId.matches("[a-f0-9]{32}") || !credentialKeyId.matches("[a-f0-9]{32}") ||
           installationId.equals("00000000000000000000000000000000") || credentialKeyId.equals("00000000000000000000000000000000") || installationId.equals(credentialKeyId) ||
           !"This Android phone".equals(displayName) || !thumbprint.matches("[a-f0-9]{64}") || !"active".equals(keyState))
            throw new Exception(HOME_IDENTITY_RECOVERY);
        java.security.cert.Certificate certificate=store.getCertificate(HOME_IDENTITY_ALIAS);
        byte[] encoded=certificate==null?null:certificate.getPublicKey().getEncoded();
        if(encoded==null || !"EC".equalsIgnoreCase(certificate.getPublicKey().getAlgorithm()) ||
           !thumbprint.equals(lowerHex(MessageDigest.getInstance("SHA-256").digest(encoded))))
            throw new Exception(HOME_IDENTITY_RECOVERY);
        JSObject result=new JSObject();result.put("version",1);result.put("installationId",installationId);
        result.put("credentialKeyId",credentialKeyId);result.put("credentialGeneration",1);result.put("displayName",displayName);
        result.put("publicKeyThumbprint",thumbprint);result.put("keyState",keyState);return result;
    }

    @PluginMethod public void homeInstallationIdentity(PluginCall call) {
        getBridge().execute(() -> {
            synchronized(HOME_IDENTITY_LOCK){
                try {
                    KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
                    android.content.SharedPreferences preferences=getContext().getSharedPreferences(HOME_IDENTITY_PREFERENCES,Context.MODE_PRIVATE);
                    boolean hasMetadata=preferences.contains(HOME_IDENTITY_RECORD),hasKey=store.containsAlias(HOME_IDENTITY_ALIAS);
                    if(hasMetadata!=hasKey){call.reject(HOME_IDENTITY_RECOVERY,"home-identity-recovery");return;}
                    if(hasMetadata){
                        String saved=preferences.getString(HOME_IDENTITY_RECORD,null);
                        if(saved==null || saved.length()>1024){call.reject(HOME_IDENTITY_RECOVERY,"home-identity-recovery");return;}
                        try{call.resolve(verifiedHomeIdentity(new JSONObject(saved),store));}
                        catch(Exception error){call.reject(HOME_IDENTITY_RECOVERY,"home-identity-recovery");}return;
                    }

                    KeyPairGenerator generator=KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC,"AndroidKeyStore");
                    generator.initialize(new KeyGenParameterSpec.Builder(HOME_IDENTITY_ALIAS,KeyProperties.PURPOSE_SIGN)
                        .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                        .setDigests(KeyProperties.DIGEST_SHA256).build());
                    generator.generateKeyPair();
                    java.security.cert.Certificate certificate=store.getCertificate(HOME_IDENTITY_ALIAS);
                    byte[] encoded=certificate==null?null:certificate.getPublicKey().getEncoded();
                    if(encoded==null)throw new Exception(HOME_IDENTITY_RECOVERY);
                    SecureRandom random=new SecureRandom();String installationId=randomOpaqueId(random),credentialKeyId;
                    do{credentialKeyId=randomOpaqueId(random);}while(credentialKeyId.equals(installationId));
                    String thumbprint=lowerHex(MessageDigest.getInstance("SHA-256").digest(encoded));
                    JSONObject metadata=new JSONObject();metadata.put("version",1);metadata.put("installationId",installationId);
                    metadata.put("credentialKeyId",credentialKeyId);metadata.put("credentialGeneration",1);
                    metadata.put("displayName","This Android phone");metadata.put("publicKeyThumbprint",thumbprint);metadata.put("keyState","active");
                    if(!preferences.edit().putString(HOME_IDENTITY_RECORD,metadata.toString()).commit())throw new Exception(HOME_IDENTITY_RECOVERY);
                    call.resolve(verifiedHomeIdentity(metadata,store));
                }catch(Exception error){
                    try{
                        KeyStore check=KeyStore.getInstance("AndroidKeyStore");check.load(null);
                        if(check.containsAlias(HOME_IDENTITY_ALIAS)){call.reject(HOME_IDENTITY_RECOVERY,"home-identity-recovery");return;}
                    }catch(Exception ignored){}
                    call.reject("Could not create this phone's Home access identity.","home-identity-unavailable");
                }
            }
        });
    }

    @PluginMethod public void credential(PluginCall call) {
        String id=call.getString("id"),value=call.getString("value");
        if(id==null || id.isEmpty() || id.length()>128){call.reject("Invalid lamp identity.");return;}
        try {
            KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
            String alias="coollamp-passwords";
            if(!store.containsAlias(alias)){
                KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
                generator.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());generator.generateKey();
            }
            SecretKey key=(SecretKey)store.getKey(alias,null);
            android.content.SharedPreferences prefs=getContext().getSharedPreferences("lamp-vault",Context.MODE_PRIVATE);
            if(value!=null){
                if(value.isEmpty()){if(!prefs.edit().remove(id).commit())throw new Exception();}
                else {
                    Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key);cipher.updateAAD(id.getBytes(StandardCharsets.UTF_8));
                    String encrypted=Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);
                    if(!prefs.edit().putString(id,encrypted).commit())throw new Exception();
                }call.resolve();return;
            }
            String saved=prefs.getString(id,null),plain="";
            if(saved!=null){
                String[] parts=saved.split(":",2);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key,new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));cipher.updateAAD(id.getBytes(StandardCharsets.UTF_8));plain=new String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);
            }
            JSObject result=new JSObject();result.put("value",plain);call.resolve(result);
        }catch(Exception e){call.reject("Could not access the saved password. Enter it again.");}
    }
}
