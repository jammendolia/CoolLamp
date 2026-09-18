package com.coollamp.controller;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.*;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name="LampNetwork")
public class LampNetworkPlugin extends Plugin {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private int generation = 0;
    private NsdManager.DiscoveryListener discovery;
    private final ArrayDeque<NsdServiceInfo> queue = new ArrayDeque<>();
    private final Map<String, JSObject> found = new LinkedHashMap<>();
    private boolean resolving = false;
    private PluginCall pending;
    private NsdManager manager;

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
    @Override protected void handleOnDestroy(){handler.post(()->finish("Discovery stopped."));}

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
