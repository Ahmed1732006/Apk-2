package com.inthevoid.platform;

import android.os.Bundle;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Must be called before super.onCreate() per the AndroidX
        // SplashScreen API contract.
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
    }
}
