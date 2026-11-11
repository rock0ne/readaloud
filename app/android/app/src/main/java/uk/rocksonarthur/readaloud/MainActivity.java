package uk.rocksonarthur.readaloud;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ReadAloudTtsPlugin.class);
        registerPlugin(AudioOpenPlugin.class);
        super.onCreate(savedInstanceState);
        // Keep the web viewport inside system bars/cutouts and the software keyboard.
        // Zero handled insets for children so modern WebView cannot apply them a second time.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, windowInsets) -> {
            int types = WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
                | WindowInsetsCompat.Type.ime();
            Insets safe = windowInsets.getInsets(types);
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            return new WindowInsetsCompat.Builder(windowInsets).setInsets(types, Insets.NONE).build();
        });
        ViewCompat.requestApplyInsets(content);
        // The web side drives the reading, so its process must keep the app's priority while the
        // screen is off and the page cannot be seen (ADR-39).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && bridge != null) {
            WebView web = bridge.getWebView();
            if (web != null) web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }
    }
}
