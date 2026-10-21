package uk.rocksonarthur.readaloud;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.k2fsa.sherpa.onnx.GeneratedAudio;
import com.k2fsa.sherpa.onnx.OfflineTts;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Kokoro made inside ReadAloud with sherpa-onnx, from the model files of the Kokoro engine app,
 * one WAV file per piece of text; and the screen-on flag while reading (ADR-27,
 * docs/05-ANDROID-KOKORO.md). Speech is made in this app's own process: the phone freezes the
 * engine app while it plays nothing itself. The web side turns the text into phonemes as the PC
 * does, so every word is spoken: sherpa-onnx's own lexicon skips each word it does not list.
 */
@CapacitorPlugin(name = "ReadAloudTts")
public class ReadAloudTtsPlugin extends Plugin {

    /** The sherpa-onnx Kokoro engine app, which holds the model (ADR-24, route 1). */
    static final String ENGINE = "com.k2fsa.sherpa.onnx.tts.engine";
    static final String MODEL_DIR = "kokoro-multi-lang-v1_0";
    static final int THREADS = 4;

    /** One clip at a time, off the plugin thread: loading takes seconds, each clip about one. */
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private OfflineTts tts;
    private int nextId;

    @PluginMethod
    public void engine(PluginCall call) {
        JSObject out = new JSObject();
        try {
            PackageManager pm = getContext().getPackageManager();
            PackageInfo info = pm.getPackageInfo(ENGINE, 0);
            out.put("installed", true);
            out.put("label", info.applicationInfo.loadLabel(pm).toString());
        } catch (PackageManager.NameNotFoundException e) {
            out.put("installed", false);
        }
        call.resolve(out);
    }

    @PluginMethod
    public void init(PluginCall call) {
        worker.execute(() -> {
            try {
                loadModel();
                call.resolve();
            } catch (Throwable e) {
                call.reject("The Kokoro voice could not load: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void synthesize(PluginCall call) {
        String phonemes = call.getString("phonemes");
        Integer sid = call.getInt("sid");
        if (phonemes == null || phonemes.trim().isEmpty() || sid == null) {
            call.reject("There is no text or no voice to speak it with.");
            return;
        }
        worker.execute(() -> {
            try {
                loadModel();
                GeneratedAudio audio = tts.generateFromPhonemes(new int[][] {phonemes.codePoints().toArray()}, sid, 1.0f);
                // Never pass silence off as speech: a proofreader would miss the words.
                if (audio.getSamples().length == 0) throw new IllegalStateException("the model made no sound");
                File dir = new File(getContext().getCacheDir(), "tts");
                if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("no folder for voice clips");
                // The web side reads each clip before it asks for the next, so older clips can go.
                File[] old = dir.listFiles();
                if (old != null) for (File f : old) f.delete();
                File file = new File(dir, "clip" + (++nextId) + ".wav");
                writeWav(file, audio.getSamples(), audio.getSampleRate());
                JSObject out = new JSObject();
                out.put("path", file.getAbsolutePath());
                call.resolve(out);
            } catch (Throwable e) {
                call.reject("The Kokoro voice could not make this clip: " + e.getMessage());
            }
        });
    }

    /** A clip being made cannot be cut short; the web side drops the ones not started yet. */
    @PluginMethod
    public void stop(PluginCall call) {
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

    /**
     * Loads the model once. Both accents share it: the phonemes carry the accent, and the
     * lexicon, which sherpa-onnx requires, is not used for them. Worker thread only.
     */
    private void loadModel() throws Exception {
        if (tts != null) return;
        Context engine = getContext().createPackageContext(ENGINE, 0);
        AssetManager assets = engine.getAssets();
        File data = espeakData(engine, assets);
        tts = OfflineTts.kokoro(assets, MODEL_DIR, MODEL_DIR + "/lexicon-gb-en.txt", "en-gb", data.getAbsolutePath(), THREADS);
    }

    /** eSpeak's data must be a folder on disk: copied from the engine app once per engine version. */
    private File espeakData(Context engine, AssetManager assets) throws Exception {
        File dir = new File(getContext().getFilesDir(), "espeak-ng-data");
        File stamp = new File(getContext().getFilesDir(), "espeak-ng-data.version");
        PackageInfo info = engine.getPackageManager().getPackageInfo(ENGINE, 0);
        String version = String.valueOf(info.getLongVersionCode());
        if (stamp.exists() && version.equals(new String(Files.readAllBytes(stamp.toPath()), StandardCharsets.UTF_8))) return dir;
        copyAssets(assets, "espeak-ng-data", dir);
        Files.write(stamp.toPath(), version.getBytes(StandardCharsets.UTF_8));
        return dir;
    }

    private static void copyAssets(AssetManager assets, String path, File to) throws IOException {
        String[] names = assets.list(path);
        if (names != null && names.length > 0) {
            if (!to.isDirectory() && !to.mkdirs()) throw new IOException("could not make " + to);
            for (String name : names) copyAssets(assets, path + "/" + name, new File(to, name));
            return;
        }
        try (InputStream in = assets.open(path); OutputStream out = new FileOutputStream(to)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        } catch (FileNotFoundException e) {
            // an empty folder
            to.mkdirs();
        }
    }

    /** 16-bit mono PCM WAV, read back on the web side by decodeWav. */
    private static void writeWav(File file, float[] samples, int rate) throws IOException {
        ByteBuffer b = ByteBuffer.allocate(44 + samples.length * 2).order(ByteOrder.LITTLE_ENDIAN);
        b.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36 + samples.length * 2);
        b.put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16);
        b.putShort((short) 1).putShort((short) 1).putInt(rate).putInt(rate * 2).putShort((short) 2).putShort((short) 16);
        b.put("data".getBytes(StandardCharsets.US_ASCII)).putInt(samples.length * 2);
        for (float s : samples) {
            float c = Math.max(-1f, Math.min(1f, s));
            b.putShort((short) (c < 0 ? c * 32768 : c * 32767));
        }
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(b.array());
        }
    }

    @Override
    protected void handleOnDestroy() {
        worker.execute(() -> {
            if (tts != null) tts.release();
            tts = null;
        });
        worker.shutdown();
    }
}
