package uk.rocksonarthur.readaloud;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

/** User-selected content URI only: no broad storage permission or remote URL fetch. */
@CapacitorPlugin(name = "AudioOpen")
public class AudioOpenPlugin extends Plugin {
    private Intent pending;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final java.util.concurrent.ConcurrentHashMap<String, File> staged = new java.util.concurrent.ConcurrentHashMap<>();

    @Override public void load() {
        worker.execute(() -> {
            File dir = new File(getContext().getCacheDir(), "audio-open");
            File[] files = dir.listFiles();
            if (files != null) for (File file : files)
                if (file.isFile() && file.getName().matches("[0-9a-f-]{36}")) file.delete();
        });
        capture(getActivity().getIntent(), false);
    }
    @Override protected void handleOnNewIntent(Intent intent) { capture(intent, true); }
    private void capture(Intent intent, boolean navigate) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction()) || intent.getData() == null) return;
        synchronized (this) { pending = new Intent(intent); }
        if (navigate) getActivity().runOnUiThread(() -> {
            if (getBridge() != null && getBridge().getWebView() != null)
                getBridge().getWebView().evaluateJavascript("window.location.hash='#/';", null);
        });
        notifyListeners("available", new JSObject(), true);
    }

    @PluginMethod public void consume(PluginCall call) {
        final Intent intent;
        synchronized (this) { intent = pending; pending = null; }
        if (intent == null) { JSObject out = new JSObject(); out.put("ready", false); call.resolve(out); return; }
        worker.execute(() -> {
            File target = null;
            try {
                Uri uri = intent.getData();
                if (uri == null || !"content".equals(uri.getScheme())
                    || (getContext().getPackageName() + ".fileprovider").equals(uri.getAuthority())
                    || (intent.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) == 0)
                    throw new IOException("Open this audio through Android Files with permission to read the selected file, or use Import audio files inside ReadAloud.");
                String name = null;
                try (Cursor cursor = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
                }
                if (name == null || !name.toLowerCase(java.util.Locale.ROOT).matches(".*\\.(wav|mp3|m4a|m4b|mp4|aac|ogg|opus|flac)$"))
                    throw new IOException("Choose a supported audio file. ZIPs use the separate book-transfer importer.");
                name = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
                if (name.length() > 200) name = name.substring(name.length() - 200);
                File dir = new File(getContext().getCacheDir(), "audio-open");
                if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Cannot stage the selected audio.");
                String token = UUID.randomUUID().toString(); target = new File(dir, token);
                long limit = Math.max(0, (dir.getUsableSpace() - 64L * 1024 * 1024) / 2), size = 0;
                try (InputStream in = getContext().getContentResolver().openInputStream(uri); OutputStream out = new FileOutputStream(target)) {
                    if (in == null) throw new IOException("Cannot read the selected audio.");
                    byte[] buffer = new byte[65536]; int count;
                    while ((count = in.read(buffer)) != -1) {
                        if (size > limit - count) throw new IOException("Not enough temporary storage to import this audio. The original is kept.");
                        out.write(buffer, 0, count); size += count;
                    }
                }
                if (size == 0) throw new IOException("The selected audio is empty.");
                staged.put(token, target);
                JSObject out = new JSObject(); out.put("ready", true); out.put("token", token);
                out.put("path", target.getAbsolutePath()); out.put("name", name); call.resolve(out);
            } catch (Throwable error) {
                if (target != null) target.delete();
                call.reject(error.getMessage() == null ? "Could not open the selected audio." : error.getMessage());
            }
        });
    }

    @PluginMethod public void release(PluginCall call) {
        String token = call.getString("token");
        File file = token == null ? null : staged.remove(token);
        if (file != null) file.delete(); call.resolve();
    }
}
