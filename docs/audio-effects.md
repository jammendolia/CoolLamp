# Frequency-reactive effects (firmware 1.6.0)

Microphone-equipped lamps now advertise seven Audio effects. Existing IDs 1–40 remain unchanged; microphone-free lamps still advertise only 1–38. Reconnect the app after flashing so it reads the updated catalog. An app with the Audio category already supports these new catalog entries without hard-coded names.

| ID | Effect | Behavior |
|---|---|---|
| 41 | Spectrum Rise | Amplitude sets height from both ends toward the saved center; frequency balance blends the color. A brief peak marker falls back toward the column. |
| 42 | Bass Launch | Bass attacks launch pulses upward, with a flare near the center. |
| 43 | Spectral Embers | Bass sets warm flame height; treble adds cool sparks. |
| 44 | Beat Bloom | Amplitude attacks trigger ripples from the center toward both ends. |
| 45 | Three-band Fountain | Three overlapping colored columns show relative bass, mid, and treble levels, scaled by overall amplitude. |

Automatic colors are orange/red for bass, green/cyan for mids, and blue/violet for treble. Choosing a custom primary color replaces the bass color; enabling two colors uses the secondary color for treble, with mids blended between them. Restore effect defaults returns the automatic frequency palette. Overall brightness and intensity still apply. Speed adjusts envelope release and pulse travel time. All spatial effects use the configured center and scale each side independently.

Sensitivity, gate and scale still determine overall response. Background noise above the configured threshold can animate these effects; tune those settings for the room first. Bass Launch and Beat Bloom use attack detection with a 180 ms refractory interval, not BPM prediction. Constant tones settle without continuously retriggering pulses.

The shared 16 kHz capture task uses fixed-point low-pass crossovers and differences to produce three broad, overlapping frequency bands. This is a musical visualization, not a calibrated FFT spectrum analyzer. No FFT buffer, external DSP dependency, or additional worker task is needed. Silence and DC are suppressed before band extraction. Band RMS and cumulative onset counters are included in `/api/audio` and USB diagnostics. PCM is neither stored nor transmitted.

A fixed six-pulse buffer bounds rendering work. Pulse tails finish within 0.6–1.59 seconds; amplitude-driven effects fade through the existing envelope. The 80 ms amplitude peak hold remains in place. Capture still stops on non-audio effects and before updates.

The audio color/options blob accepts the prior two-effect layout on upgrade, preserving IDs 39–40 while defaulting the five new slots. Base color/options blobs and GPIO assignments are unchanged. Before downgrading firmware, save a startup effect supported by the older version; older firmware cannot load the expanded audio customization blob.

USB commands `1` through `5` select IDs 41 through 45 for testing. Host checks cover tone separation, silence, full-scale arithmetic, attack refractory behavior, setting migration, microphone variant catalogs, exact black with custom black, stale-input fade-out, clock wrap, and effect bounds on one-LED through 1024-LED strips with uneven centers. Physical microphone response and aesthetic tuning remain room-dependent.

## VU Meter (46)

Amplitude fills each side from its end toward the saved center boundary. Each side scales independently, so an asymmetric center reaches full height together. Fixed height zones are green below 65%, yellow from 65% to below 80%, and red from 80% to 100%. Silence fades to black; response speed controls the falloff. Shared audio sensitivity, cutoff and contrast apply.

In the app, select VU Meter in Audio, then open Light to choose the three zone colors. Save meter colors applies immediately and persists across restarts; Restore green / yellow / red resets this palette. Color editing requires Wi-Fi and firmware 1.6.2 or newer. Bluetooth can select the effect and adjust its response speed and glow. The palette uses a separate versioned NVS record and does not alter existing effect colors or GPIO assignments.

## Automatic gain control (1.6.3)

Shared audio processing now adapts from unclipped RMS, targeting roughly 80% display height for sustained sound after contrast. Gain reduction takes about 80 ms; recovery takes about five seconds of active audio. Sensitivity remains the maximum gain. Below the noise gate, gain recovery freezes and the output remains dark. Short loud attacks can still reach full height. AGC is shared across audio effects and stays continuous when switching effects; it resets when capture restarts. Startup warmup now runs the DC filter and AGC before exposing samples.

The audio diagnostics report `automaticGain: true` and `effectiveGain` in hundredths (100 means 1x). This controls display saturation; it cannot repair clipping in the microphone itself. Host tests cover sustained audio, large volume steps, long silence, contrast settings and capture restart. Physical confirmation of the reported gradual climb remains pending.

## Room-noise rejection (1.6.4)

Version 1.6.3 could raise continuous background noise toward the AGC target whenever that noise exceeded the manual cutoff. A nonzero broadband-noise regression now reproduces that rise after a clap; zero-filled silence did not exercise it.

Capture now settles for 300 ms and measures one second of background RMS before displaying audio. Keep the room quiet during that initial second. The lower quartile of the measured blocks estimates the noise floor; the effective cutoff is the larger of the saved cutoff and twice that floor plus four RMS counts. The usual gate hysteresis applies above this cutoff. AGC and peak-hold state reset after calibration without discarding the settled DC filter.

Subsequent one-second windows can lower the learned floor if capture started during louder sound, but cannot raise it and gradually erase sustained music. Starting during continuous music can suppress that music until a quieter interval is observed; restart capture in quiet for calibration. A major later increase in background noise still requires a higher manual cutoff or restarting capture in quiet. Switching between audio effects retains the calibration. No microphone GPIO, sampling-rate or persisted-settings changes.

Audio diagnostics expose `noiseFloor` and `effectiveGate` in raw RMS counts, alongside `effectiveGain`. Tests reproduce the old climb, then verify that a clap followed by five minutes of variable background stays dark after settling and that subsequent loud/sustained audio still responds. These simulated checks do not substitute for confirmation on the physical lamp.
