# SAME negative-control speech

`speech.wav` is synthetic ordinary spoken audio, not a received broadcast.
The project-authored text is:

> This is a routine weather forecast. Mostly sunny with a light breeze. No alerts are being transmitted.

Generated locally with FFmpeg's libflite filter (default voice), mono PCM16,
24 kHz, using:

```sh
ffmpeg -f lavfi -i "flite=text='This is a routine weather forecast. Mostly sunny with a light breeze. No alerts are being transmitted.'" -ar 24000 -ac 1 -c:a pcm_s16le speech.wav
```

No external speech recording or RF capture is embedded. The regular SAME WASM
validation reads the real WAV parser output and checks for false headers and
attention tones. Other negative controls cover silence, music-like tones,
synthetic formants and noise.
