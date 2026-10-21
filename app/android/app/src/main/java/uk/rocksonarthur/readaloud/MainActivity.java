package uk.rocksonarthur.readaloud;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ReadAloudTtsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
