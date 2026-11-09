package uk.rocksonarthur.readaloud;

import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ReadAloudTtsPlugin.class);
        registerPlugin(AudioOpenPlugin.class);
        super.onCreate(savedInstanceState);
        // The web side drives the reading, so its process must keep the app's priority while the
        // screen is off and the page cannot be seen (ADR-39).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && bridge != null) {
            WebView web = bridge.getWebView();
            if (web != null) web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }
    }
}
