package uk.rocksonarthur.readaloud;

import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.k2fsa.sherpa.onnx.GeneratedAudio;
import com.k2fsa.sherpa.onnx.OfflineTts;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Kokoro made inside ReadAloud with sherpa-onnx, one WAV file per piece of text, from voice files
 * the app downloads once (ADR-27, ADR-37, docs/05-ANDROID-KOKORO.md); and the screen-on flag
 * while reading. The web side turns the text into phonemes as the PC does, so every word is
 * spoken: sherpa-onnx's own lexicon skips each word it does not list.
 */
@CapacitorPlugin(name = "ReadAloudTts")
public class ReadAloudTtsPlugin extends Plugin {

    /**
     * The voice files: a zip on ReadAloud's own GitHub release, pinned by size and SHA-256 and made
     * from the sherpa-onnx Kokoro engine APK by app/android/make-voice-zip.py (ADR-37).
     */
    static final String VOICE_URL = "https://github.com/rock0ne/readaloud/releases/download/kokoro-voice-1/readaloud-kokoro-voice-1.zip";
    static final long VOICE_BYTES = 337_939_917L;
    static final String VOICE_SHA256 = "738b47b717d888468379bd44803df4089677a8b38908b0c63b1b301fd3deefdc";
    /** Room for the zip and the 378 MB unpacked from it, with some to spare. */
    static final long SPACE_NEEDED = 800L * 1024 * 1024;
    static final String MODEL_DIR = "kokoro-multi-lang-v1_0";
    static final int THREADS = 4;

    /** One clip at a time, off the plugin thread: loading takes seconds, each clip about one. */
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    /** The download runs on its own thread, so nothing waits behind it. */
    private final ExecutorService downloader = Executors.newSingleThreadExecutor();
    private volatile boolean downloading;
    private volatile boolean cancelled;
    private OfflineTts tts;
    private int nextId;

    @Override
    public void load() {
        // The eSpeak data copied from the Kokoro engine app by ReadAloud 0.2 and earlier (ADR-27).
        worker.execute(() -> {
            deleteTree(new File(getContext().getFilesDir(), "espeak-ng-data"));
            new File(getContext().getFilesDir(), "espeak-ng-data.version").delete();
        });
    }

    /** Kept out of Android's backup: it can be downloaded again. */
    private File voiceDir() {
        return new File(getContext().getNoBackupFilesDir(), "voice");
    }

    private File partFile() {
        return new File(getContext().getNoBackupFilesDir(), "voice.zip.part");
    }

    /** The voice is in place once its folder holds the SHA-256 of the zip it came from. */
    private boolean voiceInstalled() {
        try {
            byte[] stamp = Files.readAllBytes(new File(voiceDir(), "READY").toPath());
            return VOICE_SHA256.equals(new String(stamp, StandardCharsets.UTF_8).trim());
        } catch (IOException e) {
            return false;
        }
    }

    @PluginMethod
    public void voice(PluginCall call) {
        JSObject out = new JSObject();
        out.put("installed", voiceInstalled());
        out.put("bytes", VOICE_BYTES);
        File part = partFile();
        out.put("downloaded", part.exists() ? part.length() : 0);
        call.resolve(out);
    }

    /** Downloads, checks and unpacks the voice; "download" events report the bytes so far. */
    @PluginMethod
    public void downloadVoice(PluginCall call) {
        if (downloading) {
            call.reject("The natural voice is already downloading.");
            return;
        }
        downloading = true;
        cancelled = false;
        downloader.execute(() -> {
            try {
                fetchVoice();
                call.resolve();
            } catch (Throwable e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString());
            } finally {
                downloading = false;
            }
        });
    }

    @PluginMethod
    public void removeVoice(PluginCall call) {
        cancelled = true;
        worker.execute(() -> {
            if (tts != null) tts.release();
            tts = null;
            deleteTree(voiceDir());
            partFile().delete();
            call.resolve();
        });
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
        if (!voiceInstalled()) throw new IllegalStateException("the natural voice is not on this phone yet");
        File model = new File(voiceDir(), MODEL_DIR);
        File data = new File(voiceDir(), "espeak-ng-data");
        tts = OfflineTts.kokoro(model.getAbsolutePath(), new File(model, "lexicon-gb-en.txt").getAbsolutePath(), "en-gb", data.getAbsolutePath(), THREADS);
    }

    /** Downloads the zip, going on from what an earlier try left; checks it; unpacks it. Downloader thread. */
    private void fetchVoice() throws Exception {
        if (voiceInstalled()) return;
        File part = partFile();
        long have = part.exists() ? part.length() : 0;
        if (have > VOICE_BYTES) {
            part.delete();
            have = 0;
        }
        if (getContext().getNoBackupFilesDir().getUsableSpace() + have < SPACE_NEEDED) {
            throw new IOException("there is not enough free space on this phone: the voice needs about 800 MB while it unpacks, and 380 MB after that");
        }
        if (have < VOICE_BYTES) {
            HttpURLConnection http = (HttpURLConnection) new URL(VOICE_URL).openConnection();
            http.setConnectTimeout(20_000);
            http.setReadTimeout(30_000);
            if (have > 0) http.setRequestProperty("Range", "bytes=" + have + "-");
            try {
                int code = http.getResponseCode();
                if (code == HttpURLConnection.HTTP_OK) have = 0; // the whole file: start again
                else if (code != HttpURLConnection.HTTP_PARTIAL) throw new IOException("the download server answered " + code);
                try (InputStream in = http.getInputStream(); OutputStream out = new FileOutputStream(part, have > 0)) {
                    byte[] buf = new byte[256 * 1024];
                    long told = 0;
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        if (cancelled) throw new IOException("the download was stopped");
                        out.write(buf, 0, n);
                        have += n;
                        long now = System.currentTimeMillis();
                        if (now - told >= 250) {
                            progress(have);
                            told = now;
                        }
                    }
                }
            } finally {
                http.disconnect();
            }
            progress(have);
        }
        if (part.length() != VOICE_BYTES || !VOICE_SHA256.equals(sha256(part))) {
            part.delete();
            throw new IOException("the download was damaged or was not the expected file, so it was deleted. Please try again");
        }
        unpack(part);
        part.delete();
    }

    private void progress(long loaded) {
        JSObject data = new JSObject();
        data.put("loaded", loaded);
        data.put("total", VOICE_BYTES);
        notifyListeners("download", data);
    }

    /** Unpacks into a new folder, then swaps it in, so a half-unpacked voice is never used. */
    private void unpack(File zip) throws IOException {
        File fresh = new File(getContext().getNoBackupFilesDir(), "voice.new");
        deleteTree(fresh);
        String inside = fresh.getCanonicalPath() + File.separator;
        try (ZipInputStream in = new ZipInputStream(new BufferedInputStream(new FileInputStream(zip)))) {
            byte[] buf = new byte[256 * 1024];
            for (ZipEntry e = in.getNextEntry(); e != null; e = in.getNextEntry()) {
                File f = new File(fresh, e.getName());
                if (!f.getCanonicalPath().startsWith(inside)) throw new IOException("the voice file has a bad path in it");
                if (e.isDirectory()) continue;
                File parent = f.getParentFile();
                if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("could not make " + parent);
                try (OutputStream out = new FileOutputStream(f)) {
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
            }
        }
        Files.write(new File(fresh, "READY").toPath(), VOICE_SHA256.getBytes(StandardCharsets.UTF_8));
        deleteTree(voiceDir());
        if (!fresh.renameTo(voiceDir())) throw new IOException("could not put the voice in place");
    }

    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) {
            byte[] buf = new byte[1 << 20];
            int n;
            while ((n = in.read(buf)) > 0) digest.update(buf, 0, n);
        }
        StringBuilder hex = new StringBuilder();
        for (byte b : digest.digest()) hex.append(Integer.toHexString((b & 0xff) | 0x100).substring(1));
        return hex.toString();
    }

    private static void deleteTree(File file) {
        File[] kids = file.listFiles();
        if (kids != null) for (File kid : kids) deleteTree(kid);
        file.delete();
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
        cancelled = true;
        downloader.shutdown();
        worker.execute(() -> {
            if (tts != null) tts.release();
            tts = null;
        });
        worker.shutdown();
    }
}
