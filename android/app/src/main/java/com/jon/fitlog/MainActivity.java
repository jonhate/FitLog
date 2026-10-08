package com.jon.fitlog;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle state) {
        registerPlugin(FitLogFilesPlugin.class);
        super.onCreate(state);
    }
}
