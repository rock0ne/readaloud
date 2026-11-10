package uk.rocksonarthur.readaloud;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import android.os.Build;
import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
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
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Kokoro made inside ReadAloud with sherpa-onnx, one WAV file per piece of text, from voice files
 * the app downloads once (ADR-27, ADR-37, docs/05-ANDROID-KOKORO.md); and the screen-on flag
 * while reading. The web side turns the text into phonemes as the PC does, so every word is
 * spoken: sherpa-onnx's own lexicon skips each word it does not list. It also tells
 * {@link PlaybackService} what the reader is doing, so reading goes on with the screen off and
 * the lock screen, notification, car and headset buttons reach the player (ADR-39).
 */
@CapacitorPlugin(name = "ReadAloudTts")
public class ReadAloudTtsPlugin extends Plugin {

    /**
     * The voice files: a zip on ReadAloud's own GitHub release, pinned by size and SHA-256 and made
     * from the sherpa-onnx Kokoro engine APK by app/android/make-voice-zip.py (ADR-37).
     */
    static final String VOICE_URL = "https://github.com/rock0ne/readaloud/releases/download/kokoro-voice-2/readaloud-kokoro-voice-2.zip";
    static final long VOICE_BYTES = 328_761_892L;
    static final String VOICE_SHA256 = "207abec0ca2ac0288df2a3b4796fbb2531ab851e3890fd960917d94ab2513eca";
    /** Room for the zip and the 360 MB unpacked from it, with some to spare. */
    static final long SPACE_NEEDED = 800L * 1024 * 1024;
    static final String MODEL_DIR = "kokoro-multi-lang-v1_0";
    static final int THREADS = 4;

    /** One clip at a time, off the plugin thread: loading takes seconds, each clip about one. */
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    /** The download runs on its own thread, so nothing waits behind it. */
    private final ExecutorService downloader = Executors.newSingleThreadExecutor();
    private volatile boolean downloading;
    private final java.util.concurrent.ConcurrentHashMap<String, Long> exportSizes = new java.util.concurrent.ConcurrentHashMap<>();
    private final java.util.concurrent.ConcurrentHashMap<String, Long> exportLimits = new java.util.concurrent.ConcurrentHashMap<>();
    private volatile boolean cancelled;
    private OfflineTts tts;
    private int nextId;
    private boolean askedForNotifications;

    @Override
    public void load() {
        // Lock-screen, notification, car and headset buttons go to the web side's player (ADR-39).
        PlaybackService.listener = action -> {
            JSObject data = new JSObject();
            data.put("action", action);
            notifyListeners("media", data);
        };
        // The eSpeak data copied from the Kokoro engine app by ReadAloud 0.2 and earlier (ADR-27).
        worker.execute(() -> {
            // Recover disk space from an interrupted export after a process restart.
            // Only this plugin's temporary files; never the user's saved WAVs/library.
            deleteTree(new File(getContext().getCacheDir(), "audio-exports"));
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
        // The offline distribution includes the pinned archive. Unpack it locally once;
        // there is no HTTP request and no model initialization on this status call.
        if (!voiceInstalled() && bundledVoice()) {
            downloader.execute(() -> {
                try { fetchVoice(); resolveVoice(call); }
                catch (Throwable e) { call.reject("Could not install the included voice: " + e.getMessage()); }
            });
            return;
        }
        resolveVoice(call);
    }

    private void resolveVoice(PluginCall call) {
        JSObject out = new JSObject();
        out.put("installed", voiceInstalled());
        out.put("bytes", VOICE_BYTES);
        File part = partFile();
        out.put("downloaded", part.exists() ? part.length() : 0);
        call.resolve(out);
    }

    private boolean bundledVoice() {
        try (InputStream in = getContext().getAssets().open("readaloud-kokoro-voice-2.zip")) { return true; }
        catch (IOException e) { return false; }
    }

    // Chunked transfer avoids a whole chapter's base64 occupying the Capacitor bridge.
    private File exportFile(String token) throws IOException {
        if (token == null || !token.matches("[0-9a-f-]{36}")) throw new IOException("Invalid export token");
        File dir = new File(getContext().getCacheDir(), "audio-exports");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Cannot create audio export folder");
        return new File(dir, token + ".wav");
    }

    @PluginMethod
    public void beginAudioExport(PluginCall call) {
        worker.execute(() -> {
            try {
                String token = UUID.randomUUID().toString();
                Long expected = call.getLong("expectedBytes");
                Long maximum = call.getLong("maxBytes");
                if (maximum != null && (maximum < 44 || maximum > 4_294_967_294L || expected != null)) throw new IOException("Invalid compressed audio limit");
                if (maximum != null && getContext().getCacheDir().getUsableSpace() < maximum * 2 + 64L * 1024 * 1024)
                    throw new IOException("Not enough temporary storage. Export on Windows instead.");
                if (expected != null) {
                    if (expected < 44 || expected > 4_294_967_294L) throw new IOException("Invalid whole-book WAV size");
                    if (getContext().getCacheDir().getUsableSpace() < expected * 2 + 64L * 1024 * 1024)
                        throw new IOException("Not enough free storage. Whole-book saving needs temporary and destination space; export on Windows instead.");
                }
                if (!exportFile(token).createNewFile()) throw new IOException("Cannot create audio export");
                if (expected != null) exportSizes.put(token, expected);
                if (maximum != null) exportLimits.put(token, maximum);
                JSObject out = new JSObject(); out.put("token", token); call.resolve(out);
            } catch (Throwable e) { call.reject(e.getMessage()); }
        });
    }

    /** Text exports use the same user-picked destination, without WebView blob downloads. */
    @PluginMethod
    public void saveTextExport(PluginCall call) {
        worker.execute(() -> {
            File file = null;
            try {
                String text = call.getString("text");
                String mime = call.getString("mime", "text/plain");
                if (text == null || text.length() > 16 * 1024 * 1024) throw new IOException("Text export exceeds 16 MiB");
                if (!mime.equals("text/plain") && !mime.equals("text/markdown") && !mime.equals("application/json"))
                    throw new IOException("Unsupported text format");
                byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
                if (bytes.length > 16 * 1024 * 1024) throw new IOException("Text export exceeds 16 MiB");
                String token = UUID.randomUUID().toString();
                file = exportFile(token);
                try (OutputStream out = new FileOutputStream(file)) { out.write(bytes); }
                call.getData().put("token", token);
                String name = call.getString("name", "readaloud.txt").replaceAll("[\\\\/:*?\"<>|]", "_");
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(mime).putExtra(Intent.EXTRA_TITLE, name);
                File staged = file;
                getActivity().runOnUiThread(() -> {
                    try { startActivityForResult(call, intent, "audioExportSelected"); }
                    catch (Throwable e) { staged.delete(); call.reject("Could not open Save dialog: " + e.getMessage()); }
                });
            } catch (Throwable e) { if (file != null) file.delete(); call.reject(e.getMessage()); }
        });
    }

    @PluginMethod
    public void appendAudioExport(PluginCall call) {
        worker.execute(() -> {
            try {
                String data = call.getString("data");
                if (data == null || data.length() > 90_000) throw new IOException("Invalid export chunk");
                File file = exportFile(call.getString("token"));
                if (!file.isFile()) throw new IOException("Export no longer exists");
                byte[] bytes = Base64.decode(data, Base64.NO_WRAP);
                long limit = exportSizes.getOrDefault(call.getString("token"), exportLimits.getOrDefault(call.getString("token"), 257L * 1024 * 1024));
                long position = call.getLong("position", file.length());
                if (bytes.length > 65536 || position < 0 || position > limit || bytes.length > limit - position) throw new IOException("Audio export too large");
                try (java.io.RandomAccessFile out = new java.io.RandomAccessFile(file, "rw")) { out.seek(position); out.write(bytes); }
                call.resolve();
            } catch (Throwable e) { call.reject(e.getMessage()); }
        });
    }

    @PluginMethod
    public void finishAudioExport(PluginCall call) {
        try {
            File file = exportFile(call.getString("token"));
            if (!file.isFile() || file.length() < 44) throw new IOException("Audio export is incomplete");
            Long expected = exportSizes.get(call.getString("token"));
            if (expected != null && file.length() != expected) throw new IOException("Whole-book export is incomplete");
            String name = call.getString("name", "chapter.wav").replaceAll("[\\\\/:*?\"<>|]", "_");
            String mime = call.getString("mime", "audio/wav");
            if (!mime.equals("audio/wav") && !mime.equals("audio/mpeg") && !mime.equals("audio/mp4") && !mime.equals("application/json") && !mime.equals("application/zip")) throw new IOException("Unsupported export format");
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType(mime).putExtra(Intent.EXTRA_TITLE, name);
            startActivityForResult(call, intent, "audioExportSelected");
        } catch (Throwable e) { call.reject(e.getMessage()); }
    }

    @ActivityCallback
    private void audioExportSelected(PluginCall call, ActivityResult result) {
        if (call == null) return;
        worker.execute(() -> {
            File file = null;
            try {
                file = exportFile(call.getString("token"));
                Intent data = result.getData();
                if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
                    call.reject("Saving the file was cancelled"); return;
                }
                try (InputStream in = new FileInputStream(file);
                     OutputStream out = getContext().getContentResolver().openOutputStream(data.getData(), "w")) {
                    if (out == null) throw new IOException("Cannot open the selected file");
                    byte[] buf = new byte[65536]; int n;
                    while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                }
                call.resolve();
            } catch (Throwable e) { call.reject("Could not save file: " + e.getMessage()); }
            finally { if (file != null) file.delete(); if (call.getString("token") != null) { exportSizes.remove(call.getString("token")); exportLimits.remove(call.getString("token")); } }
        });
    }

    @PluginMethod
    public void cancelAudioExport(PluginCall call) {
        worker.execute(() -> {
            try { exportFile(call.getString("token")).delete(); exportSizes.remove(call.getString("token")); exportLimits.remove(call.getString("token")); call.resolve(); }
            catch (Throwable e) { call.reject(e.getMessage()); }
        });
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

    /**
     * What the reader is doing: "playing", "paused" or "stopped", with the document's title and
     * chapter for the lock screen. Starts the foreground service on the first play, updates it
     * after that, and ends it on "stopped" (ADR-39).
     */
    @PluginMethod
    public void playback(PluginCall call) {
        String state = call.getString("state", "stopped");
        Context ctx = getContext();
        // Only Play starts the service; opening a document or stopping when it is not running does nothing.
        boolean live = PlaybackService.running || PlaybackService.starting;
        if (!live && !"playing".equals(state)) {
            call.resolve();
            return;
        }
        if ("playing".equals(state)) askForNotificationsOnce();
        Intent intent = new Intent(ctx, PlaybackService.class)
                .setAction(PlaybackService.ACTION_UPDATE)
                .putExtra(PlaybackService.EXTRA_STATE, state)
                .putExtra(PlaybackService.EXTRA_TITLE, call.getString("title", "ReadAloud"))
                .putExtra(PlaybackService.EXTRA_CHAPTER, call.getString("chapter", ""));
        try {
            if (live || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                ctx.startService(intent);
            } else {
                PlaybackService.starting = true;
                ctx.startForegroundService(intent);
            }
            call.resolve();
        } catch (RuntimeException e) {
            PlaybackService.starting = false;
            call.reject("Reading with the screen off could not start: " + e.getMessage());
        }
    }

    /**
     * Takes the audio focus for good and lets it go at once, just before the reader starts or goes
     * on, so another player such as Spotify stops and stays stopped (ADR-39). The WebView asks for
     * the focus itself while each clip plays, and for a clip shorter than a few seconds it asks
     * only to lower other players, so they played on under the voice and came back between clips.
     * A focus held here would be taken by that request, so it is not kept.
     */
    @PluginMethod
    public void takeAudioFocus(PluginCall call) {
        AudioManager audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        int result;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            AudioFocusRequest request = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build())
                    .build();
            result = audio.requestAudioFocus(request);
            audio.abandonAudioFocusRequest(request);
        } else {
            AudioManager.OnAudioFocusChangeListener none = change -> {};
            result = audio.requestAudioFocus(none, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
            audio.abandonAudioFocus(none);
        }
        JSObject out = new JSObject();
        out.put("granted", result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED);
        call.resolve(out);
    }

    /**
     * Android 13 and later hide the reading notification, and with it the lock-screen controls,
     * until the app may post notifications. Reading with the screen off works either way. Asked
     * once per launch, at the first Play; Android itself stops asking after two refusals.
     */
    private void askForNotificationsOnce() {
        if (askedForNotifications || Build.VERSION.SDK_INT < 33) return;
        askedForNotifications = true;
        Activity activity = getActivity();
        if (activity == null || activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        activity.runOnUiThread(() -> activity.requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, 39));
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
        // Sleep idle ONNX workers instead of burning CPU cycles while waiting for work.
        // These session options are supported by the pinned runtime in the engine APK (ADR-40).
        File policy = new File(getContext().getCacheDir(), "kokoro-cpu.conf");
        try (FileOutputStream out = new FileOutputStream(policy)) {
            out.write(("SessionConfig.session.intra_op.allow_spinning=0\n"
                + "SessionConfig.session.inter_op.allow_spinning=0\n").getBytes(StandardCharsets.UTF_8));
        }
        tts = OfflineTts.kokoro(model.getAbsolutePath(), new File(model, "lexicon-gb-en.txt").getAbsolutePath(), THREADS, "cpu:" + policy.getAbsolutePath());
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
        if (have < VOICE_BYTES && bundledVoice()) {
            try (InputStream in = getContext().getAssets().open("readaloud-kokoro-voice-2.zip");
                 OutputStream out = new FileOutputStream(part)) {
                byte[] buf = new byte[256 * 1024]; int n; have = 0;
                while ((n = in.read(buf)) != -1) {
                    if (cancelled) throw new IOException("Voice installation stopped");
                    out.write(buf, 0, n); have += n;
                }
            }
            progress(have);
        } else if (have < VOICE_BYTES) {
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
        PlaybackService.listener = null;
        if (PlaybackService.running) {
            try {
                getContext().startService(new Intent(getContext(), PlaybackService.class)
                        .setAction(PlaybackService.ACTION_UPDATE)
                        .putExtra(PlaybackService.EXTRA_STATE, "stopped"));
            } catch (RuntimeException e) {
                // The service ends by itself after 30 minutes paused.
            }
        }
        cancelled = true;
        downloader.shutdown();
        worker.execute(() -> {
            if (tts != null) tts.release();
            tts = null;
        });
        worker.shutdown();
    }
}
