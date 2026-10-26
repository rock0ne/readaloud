package uk.rocksonarthur.readaloud;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

/**
 * Keeps ReadAloud reading with the screen off (ADR-39). While a document is open in the reader it
 * runs as a media-playback foreground service, so Android neither freezes nor stops the app that
 * makes the voice; holds a CPU wake lock while it reads, so the next clips are still made with the
 * screen off; and owns the media session behind the lock-screen and notification controls and the
 * play, pause and skip buttons of a car or headset. It does not play sound itself: the web side
 * still plays each clip and only tells this service what it is doing. It does not hold the audio
 * focus either: the WebView asks for it while each clip plays, and that request took a focus held
 * here away, which paused the reading 0.2 s into the first clip. The plugin's
 * {@code takeAudioFocus} stops other players instead.
 */
public class PlaybackService extends Service {

    static final String ACTION_UPDATE = "uk.rocksonarthur.readaloud.UPDATE";
    static final String ACTION_PLAY = "uk.rocksonarthur.readaloud.PLAY";
    static final String ACTION_PAUSE = "uk.rocksonarthur.readaloud.PAUSE";
    static final String ACTION_NEXT = "uk.rocksonarthur.readaloud.NEXT";
    static final String ACTION_PREVIOUS = "uk.rocksonarthur.readaloud.PREVIOUS";
    static final String EXTRA_STATE = "state";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_CHAPTER = "chapter";

    private static final String CHANNEL = "reading";
    private static final int NOTIFICATION_ID = 1;
    /** Paused this long, the service ends and the notification goes. */
    private static final long IDLE_STOP_MS = 30L * 60 * 1000;
    /** A safety limit on the wake lock; each update while reading renews it. */
    private static final long WAKE_LOCK_MS = 3L * 60 * 60 * 1000;

    /** Where the buttons go: set by the plugin while the web side is alive. */
    interface Listener {
        void onMediaAction(String action);
    }

    static volatile Listener listener;
    /** True from onCreate to onDestroy, so the plugin knows whether to start or only update. */
    static volatile boolean running;
    /** Set by the plugin as it starts the service, so a second Play before onCreate only updates. */
    static volatile boolean starting;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable idleStop = this::stopNow;
    private MediaSession session;
    private PowerManager.WakeLock wakeLock;
    private boolean playing;
    /** Whether startForeground has been called; later changes only refresh the notification. */
    private boolean foreground;
    private String title = "ReadAloud";
    private String chapter = "";

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        starting = false;
        session = new MediaSession(this, "ReadAloud");
        session.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() {
                send("play");
            }

            @Override
            public void onPause() {
                send("pause");
            }

            @Override
            public void onStop() {
                send("pause");
            }

            @Override
            public void onSkipToNext() {
                send("next");
            }

            @Override
            public void onSkipToPrevious() {
                send("previous");
            }
        });
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            // Needed only before Android 8, where they are not yet on by default.
            session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        }
        session.setSessionActivity(openApp());
        session.setActive(true);
        PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ReadAloud:reading");
        wakeLock.setReferenceCounted(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Reading", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Shows what ReadAloud is reading, with play and pause, while it reads with the screen off.");
            channel.setShowBadge(false);
            ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).createNotificationChannel(channel);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_UPDATE.equals(action)) {
            String t = intent.getStringExtra(EXTRA_TITLE);
            String c = intent.getStringExtra(EXTRA_CHAPTER);
            title = t != null && !t.isEmpty() ? t : "ReadAloud";
            chapter = c != null ? c : "";
            apply(intent.getStringExtra(EXTRA_STATE));
        } else if (ACTION_PLAY.equals(action)) {
            send("play");
        } else if (ACTION_PAUSE.equals(action)) {
            send("pause");
        } else if (ACTION_NEXT.equals(action)) {
            send("next");
        } else if (ACTION_PREVIOUS.equals(action)) {
            send("previous");
        }
        // Not restarted by Android after it ends: only the reader starts it.
        return START_NOT_STICKY;
    }

    private void apply(String state) {
        if (state == null || "stopped".equals(state)) {
            stopNow();
            return;
        }
        playing = "playing".equals(state);
        session.setMetadata(new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, chapter)
                .putString(MediaMetadata.METADATA_KEY_ALBUM, "ReadAloud")
                .build());
        session.setPlaybackState(new PlaybackState.Builder()
                .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                        | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_STOP)
                .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, playing ? 1f : 0f)
                .build());
        if (!foreground) {
            try {
                // The first update follows startForegroundService, which requires this call.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                } else {
                    startForeground(NOTIFICATION_ID, notification());
                }
                foreground = true;
            } catch (RuntimeException e) {
                // Android refused (for example a start from the background): reading goes on with
                // the screen on, as before this service existed.
                stopNow();
                return;
            }
        } else {
            // Already in the foreground: only the notification changes, which is allowed while
            // the screen is off.
            ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).notify(NOTIFICATION_ID, notification());
        }
        handler.removeCallbacks(idleStop);
        if (playing) {
            wakeLock.acquire(WAKE_LOCK_MS);
        } else {
            if (wakeLock.isHeld()) wakeLock.release();
            handler.postDelayed(idleStop, IDLE_STOP_MS);
        }
    }

    private Notification notification() {
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL)
                : new Notification.Builder(this);
        b.setSmallIcon(playing ? android.R.drawable.ic_media_play : android.R.drawable.ic_media_pause)
                .setContentTitle(title)
                .setContentText(chapter)
                .setContentIntent(openApp())
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setCategory(Notification.CATEGORY_TRANSPORT)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setOngoing(playing)
                .addAction(action(android.R.drawable.ic_media_previous, "Previous sentence", ACTION_PREVIOUS, 1))
                .addAction(playing
                        ? action(android.R.drawable.ic_media_pause, "Pause", ACTION_PAUSE, 2)
                        : action(android.R.drawable.ic_media_play, "Play", ACTION_PLAY, 3))
                .addAction(action(android.R.drawable.ic_media_next, "Next sentence", ACTION_NEXT, 4))
                .setStyle(new Notification.MediaStyle()
                        .setMediaSession(session.getSessionToken())
                        .setShowActionsInCompactView(0, 1, 2));
        return b.build();
    }

    private Notification.Action action(int icon, String label, String what, int code) {
        Intent intent = new Intent(this, PlaybackService.class).setAction(what);
        PendingIntent pi = PendingIntent.getService(this, code, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Action.Builder(Icon.createWithResource(this, icon), label, pi).build();
    }

    private PendingIntent openApp() {
        Intent intent = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private void send(String action) {
        Listener l = listener;
        if (l != null) l.onMediaAction(action);
    }

    private void stopNow() {
        handler.removeCallbacks(idleStop);
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        stopForeground(STOP_FOREGROUND_REMOVE);
        foreground = false;
        stopSelf();
    }

    @Override
    public void onDestroy() {
        running = false;
        starting = false;
        handler.removeCallbacks(idleStop);
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (session != null) {
            session.setActive(false);
            session.release();
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
