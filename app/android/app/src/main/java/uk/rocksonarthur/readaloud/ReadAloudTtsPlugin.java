package uk.rocksonarthur.readaloud;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * The phone's Kokoro voice engine, used to write each piece of text as a WAV file, and the
 * screen-on flag while reading (ADR-27, docs/05-ANDROID-KOKORO.md).
 */
@CapacitorPlugin(name = "ReadAloudTts")
public class ReadAloudTtsPlugin extends Plugin {

    /** The sherpa-onnx Kokoro engine app (ADR-24, route 1). */
    static final String ENGINE = "com.k2fsa.sherpa.onnx.tts.engine";

    private TextToSpeech tts;
    private boolean ready;
    private final List<PluginCall> waitingForInit = new ArrayList<>();
    private final Map<String, PluginCall> calls = new ConcurrentHashMap<>();
    private final Map<String, File> files = new ConcurrentHashMap<>();
    private final AtomicInteger nextId = new AtomicInteger();

    @PluginMethod
    public void engine(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        JSObject out = new JSObject();
        out.put("installed", false);
        for (ResolveInfo info : pm.queryIntentServices(new Intent(TextToSpeech.Engine.INTENT_ACTION_TTS_SERVICE), 0)) {
            if (ENGINE.equals(info.serviceInfo.packageName)) {
                out.put("installed", true);
                out.put("label", info.loadLabel(pm).toString());
            }
        }
        call.resolve(out);
    }

    @PluginMethod
    public synchronized void init(PluginCall call) {
        if (ready) {
            call.resolve();
            return;
        }
        waitingForInit.add(call);
        if (tts == null) tts = new TextToSpeech(getContext(), this::onInit, ENGINE);
    }

    private synchronized void onInit(int status) {
        if (status == TextToSpeech.SUCCESS) {
            ready = true;
            // Speed is the player's (spec 8.2): the engine always makes speech at 1.0.
            tts.setSpeechRate(1.0f);
            tts.setOnUtteranceProgressListener(progress);
            for (PluginCall c : waitingForInit) c.resolve();
        } else {
            tts.shutdown();
            tts = null;
            for (PluginCall c : waitingForInit) c.reject("The Kokoro engine app did not start (status " + status + ").");
        }
        waitingForInit.clear();
    }

    @PluginMethod
    public void synthesize(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.trim().isEmpty()) {
            call.reject("There is no text to speak.");
            return;
        }
        if (!ready) {
            call.reject("The Kokoro engine app is not started yet.");
            return;
        }
        File dir = new File(getContext().getCacheDir(), "tts");
        if (!dir.isDirectory() && !dir.mkdirs()) {
            call.reject("Could not make a folder for voice clips.");
            return;
        }
        // The web side reads each clip before it asks for the next, so older clips can go.
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) f.delete();
        String id = "clip" + nextId.incrementAndGet();
        File file = new File(dir, id + ".wav");
        calls.put(id, call);
        files.put(id, file);
        if (tts.synthesizeToFile(text, new Bundle(), file, id) != TextToSpeech.SUCCESS) {
            fail(id, "The Kokoro engine app did not take the text.");
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (tts != null) tts.stop();
        for (String id : calls.keySet()) fail(id, "Stopped.");
        call.resolve();
    }

    @PluginMethod
    public void keepScreenOn(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    private void fail(String id, String message) {
        files.remove(id);
        PluginCall call = calls.remove(id);
        if (call != null) call.reject(message);
    }

    private final UtteranceProgressListener progress = new UtteranceProgressListener() {
        @Override
        public void onStart(String id) {}

        @Override
        public void onDone(String id) {
            File file = files.remove(id);
            PluginCall call = calls.remove(id);
            if (call == null || file == null) return;
            JSObject out = new JSObject();
            out.put("path", file.getAbsolutePath());
            call.resolve(out);
        }

        @Override
        @Deprecated
        public void onError(String id) {
            fail(id, "The Kokoro engine app could not make this clip.");
        }

        @Override
        public void onError(String id, int code) {
            fail(id, "The Kokoro engine app could not make this clip (error " + code + ").");
        }

        @Override
        public void onStop(String id, boolean interrupted) {
            fail(id, "Stopped.");
        }
    };

    @Override
    protected void handleOnDestroy() {
        if (tts != null) tts.shutdown();
        tts = null;
        ready = false;
    }
}
