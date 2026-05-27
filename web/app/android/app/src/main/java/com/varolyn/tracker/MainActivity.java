package com.varolyn.tracker;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
