package com.coollamp.controller;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(LampNetworkPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
