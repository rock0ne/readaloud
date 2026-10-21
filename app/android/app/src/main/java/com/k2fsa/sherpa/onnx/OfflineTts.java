package com.k2fsa.sherpa.onnx;

import android.content.res.AssetManager;

/**
 * Java side of sherpa-onnx's offline TTS library (libsherpa-onnx-jni.so, 1.13.8, Apache-2.0),
 * taken from the Kokoro engine app's APK (ADR-27). The library reads these classes and their
 * fields by name, so the names and types follow sherpa-onnx's own Kotlin API exactly; ReadAloud
 * only fills the Kokoro part.
 */
public final class OfflineTts {

    static {
        System.loadLibrary("sherpa-onnx-jni");
    }

    private long ptr;

    private OfflineTts(AssetManager assets, OfflineTtsConfig config) {
        ptr = newFromAsset(assets, config);
        if (ptr == 0) throw new IllegalStateException("sherpa-onnx could not load the Kokoro model.");
    }

    /**
     * Kokoro from another app's assets (the model files) plus a folder on disk (eSpeak's data).
     *
     * @param lexicon comma-separated lexicon files inside the assets (sherpa-onnx needs one)
     * @param lang eSpeak language, e.g. "en-gb"
     */
    public static OfflineTts kokoro(AssetManager assets, String modelDir, String lexicon, String lang, String dataDir, int numThreads) {
        OfflineTtsKokoroModelConfig kokoro = new OfflineTtsKokoroModelConfig();
        kokoro.model = modelDir + "/model.onnx";
        kokoro.voices = modelDir + "/voices.bin";
        kokoro.tokens = modelDir + "/tokens.txt";
        kokoro.lexicon = lexicon;
        kokoro.lang = lang;
        kokoro.dataDir = dataDir;
        OfflineTtsModelConfig model = new OfflineTtsModelConfig();
        model.kokoro = kokoro;
        model.numThreads = numThreads;
        OfflineTtsConfig config = new OfflineTtsConfig();
        config.model = model;
        return new OfflineTts(assets, config);
    }

    public int sampleRate() {
        return getSampleRate(ptr);
    }

    public int numSpeakers() {
        return getNumSpeakers(ptr);
    }

    /** Speech for the text with speaker `sid`, at `speed` (1.0 = the voice's own pace). */
    public GeneratedAudio generate(String text, int sid, float speed) {
        return generateImpl(ptr, text, sid, speed);
    }

    /**
     * Speech from phonemes made by the caller, one array of Unicode code points per piece: the
     * model reads every word, where the lexicon route skips any word it does not list. The text
     * is left empty, as sherpa-onnx's own engine app does in this mode.
     */
    public GeneratedAudio generateFromPhonemes(int[][] phonemes, int sid, float speed) {
        GenerationConfig config = new GenerationConfig();
        config.sid = sid;
        config.speed = speed;
        config.phonemeCodepoints = phonemes;
        return generateWithConfigImpl(ptr, "", config, null);
    }

    public void release() {
        if (ptr != 0) delete(ptr);
        ptr = 0;
    }

    private native long newFromAsset(AssetManager assets, OfflineTtsConfig config);

    private native void delete(long ptr);

    private native GeneratedAudio generateImpl(long ptr, String text, int sid, float speed);

    /** `callback` is a kotlin.jvm.functions.Function1 in sherpa-onnx; ReadAloud passes none. */
    private native GeneratedAudio generateWithConfigImpl(long ptr, String text, GenerationConfig config, Object callback);

    private native int getSampleRate(long ptr);

    private native int getNumSpeakers(long ptr);
}

// The configuration classes the library reads. Defaults follow sherpa-onnx's Kotlin API; every
// String must be non-null, because the library reads each one.

final class OfflineTtsConfig {
    OfflineTtsModelConfig model = new OfflineTtsModelConfig();
    String ruleFsts = "";
    String ruleFars = "";
    int maxNumSentences = 1;
    float silenceScale = 0.2f;
}

final class OfflineTtsModelConfig {
    OfflineTtsVitsModelConfig vits = new OfflineTtsVitsModelConfig();
    OfflineTtsMatchaModelConfig matcha = new OfflineTtsMatchaModelConfig();
    OfflineTtsKokoroModelConfig kokoro = new OfflineTtsKokoroModelConfig();
    OfflineTtsZipVoiceModelConfig zipvoice = new OfflineTtsZipVoiceModelConfig();
    OfflineTtsKittenModelConfig kitten = new OfflineTtsKittenModelConfig();
    OfflineTtsPocketModelConfig pocket = new OfflineTtsPocketModelConfig();
    OfflineTtsSupertonicModelConfig supertonic = new OfflineTtsSupertonicModelConfig();
    int numThreads = 1;
    boolean debug = false;
    String provider = "cpu";
}

final class OfflineTtsVitsModelConfig {
    String model = "";
    String lexicon = "";
    String tokens = "";
    String dataDir = "";
    String dictDir = "";
    float noiseScale = 0.667f;
    float noiseScaleW = 0.8f;
    float lengthScale = 1.0f;
}

final class OfflineTtsMatchaModelConfig {
    String acousticModel = "";
    String vocoder = "";
    String lexicon = "";
    String tokens = "";
    String dataDir = "";
    String dictDir = "";
    float noiseScale = 1.0f;
    float lengthScale = 1.0f;
}

final class OfflineTtsKokoroModelConfig {
    String model = "";
    String voices = "";
    String tokens = "";
    String dataDir = "";
    String lexicon = "";
    String lang = "";
    String dictDir = "";
    float lengthScale = 1.0f;
}

final class OfflineTtsZipVoiceModelConfig {
    String tokens = "";
    String encoder = "";
    String decoder = "";
    String vocoder = "";
    String dataDir = "";
    String lexicon = "";
    float featScale = 0.1f;
    float tShift = 0.5f;
    float targetRms = 0.1f;
    float guidanceScale = 1.0f;
}

final class OfflineTtsKittenModelConfig {
    String model = "";
    String voices = "";
    String tokens = "";
    String dataDir = "";
    String lexicon = "";
    float lengthScale = 1.0f;
}

final class OfflineTtsPocketModelConfig {
    String decoder = "";
    String encoder = "";
    String lmFlow = "";
    String lmMain = "";
    String textConditioner = "";
    String tokenScoresJson = "";
    String vocabJson = "";
    int voiceEmbeddingCacheCapacity = 50;
}

final class OfflineTtsSupertonicModelConfig {
    String durationPredictor = "";
    String textEncoder = "";
    String ttsJson = "";
    String unicodeIndexer = "";
    String vectorEstimator = "";
    String vocoder = "";
    String voiceStyle = "";
}

/** One request's settings; the library reads these fields by name. Defaults as sherpa-onnx's. */
final class GenerationConfig {
    float silenceScale = 0.2f;
    float speed = 1.0f;
    int sid = 0;
    float[] referenceAudio = null;
    int referenceSampleRate = 0;
    String referenceText = null;
    int numSteps = 5;
    java.util.Map<String, String> extra = null;
    int[][] phonemeCodepoints = null;
    String[][] tokens = null;
}
