package com.k2fsa.sherpa.onnx;

/** Speech made by {@link OfflineTts}; the library creates it with this constructor. */
public final class GeneratedAudio {

    private final float[] samples;
    private final int sampleRate;

    public GeneratedAudio(float[] samples, int sampleRate) {
        this.samples = samples;
        this.sampleRate = sampleRate;
    }

    public float[] getSamples() {
        return samples;
    }

    public int getSampleRate() {
        return sampleRate;
    }
}
