import type { MeteorBiasCommand } from "./meteor/bias";
import { MeteorImageStore } from "./meteor/image-store";
import type { MeteorStatus, ChannelImage } from "./meteor/model";
import type { MeteorReplayRequest } from "./components/MeteorPanel";
import type { ReplayState } from "./radio";
const MeteorPanel = lazy(() =>
  import("./components/MeteorPanel").then((m) => ({ default: m.MeteorPanel })),
);
import { useEffect, useRef, useState, lazy, Suspense } from "react";
import {
  Activity,
  AudioLines,
  ChevronDown,
  CircleHelp,
  Cpu,
  FlaskConical,
  Headphones,
  Minus,
  Plus,
  Power,
  Radio,
  SlidersHorizontal,
  Square,
  Usb,
  Volume2,
  X,
} from "lucide-react";
import { BrowserAudio } from "./audio";
import { Spectrum } from "./components/Spectrum";
import { MultiplexSpectrumView } from "./components/MultiplexSpectrum";
import { RdsPanel } from "./components/RdsPanel";
import type { RdsStatus } from "./rds/model";
import { WwvPanel } from "./components/WwvPanel";
import { ArmerPanel } from "./components/ArmerPanel";
import { PresetPanel } from "./components/PresetPanel";
import { IqRecordingPanel } from "./components/IqRecordingPanel";
import {
  captureName,
  idleRecording,
  type RecordingState,
} from "./recording/model";
import { folderSink, downloadSink } from "./recording/storage";
import { Rtl433Panel } from "./components/Rtl433Panel";
import type {
  Rtl433Message,
  Rtl433Status,
  Rtl433Protocol,
} from "./rtl433/model";
import { OokPanel } from "./components/OokPanel";
import type { OokCapture, OokStatus } from "./ook/model";
import { NfmPanel } from "./components/NfmPanel";
import { SquelchSelect, ToneSelect } from "./components/ToneSelect";
import {
  presetSettings,
  type NfmFeed,
  type NfmTelemetry,
  type NfmActivity,
  type NfmMonitorConfig,
} from "./presets/model";
import {
  loadArmerConfig,
  type ArmerFeed,
  type P25Event,
  type ArmerStatus,
  type TalkgroupRule,
} from "./armer/model";
import starterAliases from "./armer/starter.json";
import { AutoCenterTiming, chooseArmerCenter } from "./armer/auto-center";
import { listens } from "./armer/model";
import {
  compatibility,
  receiverCapabilities,
  wwvFrequencies,
} from "./decoders";
import type { WwvStatus, MultiplexSpectrum } from "./types";
import {
  AUDIO_RATE,
  decoders,
  defaults,
  FFT_SIZE,
  moveCenter,
  readSettings,
  SAMPLE_RATE,
  validateSettings,
  type Settings,
} from "./model";
import { RadioSession } from "./radio";
import { AppAccess } from "./components/AppAccess";

const mhz = (hz: number) => (hz / 1e6).toFixed(4);
const spanLabel = (hz: number) =>
  hz >= 1e6 ? `${(hz / 1e6).toFixed(1)} MHz` : `${hz / 1000} kHz`;
type Metrics = {
  rms: number;
  clipping: number;
  cpu: number;
  backlog: number;
  samples: number;
  stereo: boolean;
};
const emptyMetrics: Metrics = {
  rms: -120,
  clipping: 0,
  cpu: 0,
  backlog: 0,
  samples: 0,
  stereo: false,
};

export default function App() {
  const [settings, setSettings] = useState(readSettings);
  const [meteorStatus, setMeteorStatus] = useState<MeteorStatus | null>(null);
  const [meteorImages, setMeteorImages] = useState<ChannelImage[]>([]);
  const [meteorConstellation, setMeteorConstellation] =
    useState<Float32Array | null>(null);
  const meteorStore = useRef(new MeteorImageStore());
  const [replay, setReplay] = useState<ReplayState | null>(null);
  const [replayView, setReplayView] = useState<{
    settings: Settings;
    sampleRate: number;
  } | null>(null);
  function resetMeteor() {
    meteorStore.current.clear();
    setMeteorStatus(null);
    setMeteorImages([]);
    setMeteorConstellation(null);
  }
  const [recording, setRecording] = useState<RecordingState>(idleRecording);
  const [recordPreparing, setRecordPreparing] = useState(false);
  const recordIntent = useRef(false);
  const [rtlStatus, setRtlStatus] = useState<Rtl433Status | null>(null);
  const [rtlProtocols, setRtlProtocols] = useState<Rtl433Protocol[]>([]);
  const [rtlMessages, setRtlMessages] = useState<Rtl433Message[]>([]);
  const rtlLatest = useRef<Rtl433Status | null>(null),
    rtlPending = useRef<Rtl433Message[]>([]),
    rtlId = useRef(0);
  const [rtlTest, setRtlTest] = useState(false);
  function flushRtl() {
    if (rtlLatest.current) setRtlStatus(rtlLatest.current);
    if (rtlPending.current.length) {
      const messages = rtlPending.current.splice(0);
      setRtlMessages((old) => [...old, ...messages].slice(-300));
    }
  }
  const [ookStatus, setOokStatus] = useState<OokStatus | null>(null);
  const [ookCaptures, setOokCaptures] = useState<OokCapture[]>([]);
  const ookLatest = useRef<OokStatus | null>(null),
    ookPending = useRef<OokCapture[]>([]),
    ookId = useRef(0);
  const [ookTest, setOokTest] = useState(false);
  const [armerConfig, setArmerConfig] = useState(() =>
    loadArmerConfig(starterAliases as TalkgroupRule[]),
  );
  const [armerFeed, setArmerFeed] = useState<ArmerFeed>({
    status: null,
    events: [],
  });
  const [armerGeneration, setArmerGeneration] = useState(0);
  const [nfmFeed, setNfmFeed] = useState<NfmFeed>({ status: null, events: [] });
  const nfmStatus = useRef<NfmTelemetry | null>(null),
    nfmPending = useRef<NfmActivity[]>([]);
  const [appliedMonitor, setAppliedMonitor] = useState<NfmMonitorConfig | null>(
    null,
  );
  const [nfmTest, setNfmTest] = useState(false);
  const [armerTest, setArmerTest] = useState(false);
  const armerPending = useRef<P25Event[]>([]);
  const armerStatus = useRef<ArmerStatus | null>(null);
  const armerReceivedAt = useRef(0);
  const autoCenterTiming = useRef(new AutoCenterTiming());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [centerInput, setCenterInput] = useState(mhz(settings.center));
  const [channelInput, setChannelInput] = useState(mhz(settings.channel));
  const [rfDraft, setRfDraft] = useState({
    gain: settings.gain ?? 25.4,
    auto: settings.gain === null,
    ppm: String(settings.ppm),
  });
  const [source, setSource] = useState<"idle" | "live" | "test" | "replay">(
    "idle",
  );
  const [busy, setBusy] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(50);
  const [error, setError] = useState("");
  const [help, setHelp] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [peakHold, setPeakHold] = useState(false);
  const [floor, setFloor] = useState(-100);
  const [multiplexOpen, setMultiplexOpen] = useState(false);
  const multiplexEnabled = multiplexOpen && settings.decoder === "wfm";
  const multiplexVisible = useRef(multiplexEnabled);
  multiplexVisible.current = multiplexEnabled;
  const multiplex = useRef<MultiplexSpectrum | null>(null);
  const [rds, setRds] = useState<RdsStatus | null>(null);
  const [rdsTest, setRdsTest] = useState(false);
  const [metrics, setMetrics] = useState(emptyMetrics);
  const [wwv, setWwv] = useState<WwvStatus | null>(null);
  const [wwvOrigin, setWwvOrigin] = useState<"live" | "test" | null>(null);
  const lastWwv = useRef<WwvStatus | null>(null);
  const [testSpeed, setTestSpeed] = useState(16);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const speedRef = useRef(testSpeed);
  speedRef.current = testSpeed;
  const fft = useRef<Float32Array | null>(null);
  const radio = useRef<RadioSession | null>(null);
  const audio = useRef<BrowserAudio | null>(null);
  if (!radio.current) radio.current = new RadioSession();
  if (!audio.current) audio.current = new BrowserAudio();
  const active = source !== "idle";
  const recordLocked =
    recordPreparing ||
    recording.phase === "recording" ||
    recording.phase === "saving";
  const rfPending =
    settings.gain !== (rfDraft.auto ? null : rfDraft.gain) ||
    settings.ppm !== Number(rfDraft.ppm);
  useEffect(() => {
    let last = 0,
      samples = 0;
    const session = radio.current!,
      player = audio.current!;
    session.onRecording = setRecording;
    session.onReplay = (state) => {
      setReplay(state);
      if (state.phase === "complete") setSource("idle");
    };
    session.onFrame = (frame, backlog) => {
      if (frame.spectrum) fft.current = frame.spectrum;
      let stereo = false;
      for (const event of frame.events) {
        if (event.type === "reset" && event.protocol === "meteor")
          resetMeteor();
        if (event.type === "telemetry" && event.protocol === "meteor") {
          setMeteorStatus(event.status);
          setMeteorConstellation(event.constellation);
        }
        if (event.type === "image" && event.protocol === "meteor") {
          meteorStore.current.merge(event.image);
          setMeteorImages(meteorStore.current.images());
        }
        if (event.type === "spectrum" && multiplexVisible.current)
          multiplex.current = event.multiplex;
        if (event.type === "selection" && event.protocol === "nfm")
          player.clear();
        if (
          event.type === "audio" &&
          !(
            sourceRef.current === "test" &&
            settingsRef.current.decoder === "wwv" &&
            speedRef.current > 1
          )
        )
          player.push(event.samples);
        if (event.type === "telemetry" && event.protocol === "wfm") {
          stereo = event.stereo;
          if (event.rds) setRds(event.rds);
        }
        if (event.type === "telemetry" && event.protocol === "rtl433") {
          rtlLatest.current = event.status;
          if (event.status.protocols) setRtlProtocols(event.status.protocols);
        }
        if (event.type === "message" && event.protocol === "rtl433") {
          rtlPending.current.push({
            id: ++rtlId.current,
            receivedAt: new Date().toISOString(),
            source: sourceRef.current === "test" ? "test" : "live",
            frequency: settingsRef.current.channel,
            bandwidth: settingsRef.current.bandwidth,
            data: event.data,
          });
          if (rtlPending.current.length > 300) rtlPending.current.shift();
        }
        if (event.type === "telemetry" && event.protocol === "ook")
          ookLatest.current = event.status;
        if (event.type === "message" && event.protocol === "ook") {
          ookPending.current.push({
            ...event.burst,
            id: ++ookId.current,
            frequency: settingsRef.current.channel,
            bandwidth: settingsRef.current.bandwidth,
            options: { ...settingsRef.current.ook },
            test: sourceRef.current === "test",
            receivedAt: new Date().toISOString(),
          });
          if (ookPending.current.length > 100) ookPending.current.shift();
        }
        if (event.type === "timecode") lastWwv.current = event.status;
        if (event.type === "message" && event.protocol === "armer")
          armerPending.current.push(event.event);
        if (event.type === "telemetry" && event.protocol === "armer") {
          armerStatus.current = event.status;
          armerReceivedAt.current = performance.now();
        }
        if (event.type === "telemetry" && event.protocol === "nfm")
          nfmStatus.current = event.status;
        if (event.type === "activity" && event.protocol === "nfm")
          nfmPending.current.push(event.event);
      }
      samples += frame.samples;
      if (performance.now() - last > 180) {
        setMetrics({
          rms: frame.rms,
          clipping: frame.clipping,
          cpu: frame.samples
            ? (frame.elapsed /
                ((frame.samples / (frame.sampleRate ?? SAMPLE_RATE)) * 1000)) *
              100
            : 0,
          backlog,
          samples,
          stereo,
        });
        flushRtl();
        if (lastWwv.current) setWwv(lastWwv.current);
        if (ookLatest.current) setOokStatus(ookLatest.current);
        if (ookPending.current.length) {
          const captures = ookPending.current.splice(0);
          setOokCaptures((old) => [...old, ...captures].slice(-100));
        }
        if (armerStatus.current)
          setArmerFeed({
            status: armerStatus.current,
            events: armerPending.current.splice(0),
          });
        if (nfmStatus.current)
          setNfmFeed({
            status: nfmStatus.current,
            events: nfmPending.current.splice(0),
          });
        last = performance.now();
      }
    };
    session.onError = (message) => {
      player.pause();
      setPlaying(false);
      setError(message);
      void session.stop().finally(() => {
        setSource("idle");
        setAppliedMonitor(null);
        setBusy(false);
      });
    };
    return () => {
      void session.stop();
      void player.close();
    };
  }, []);
  useEffect(() => {
    multiplex.current = null;
    radio.current!.setWfmMultiplex(multiplexEnabled);
  }, [multiplexEnabled]);
  useEffect(() => {
    try {
      localStorage.setItem("spectrum-settings", JSON.stringify(settings));
    } catch {
      /* Storage may be disabled. */
    }
  }, [settings]);
  useEffect(() => {
    try {
      localStorage.setItem("spectrum-armer-v1", JSON.stringify(armerConfig));
    } catch {
      /* Storage optional. */
    }
  }, [armerConfig]);
  // Alias text edits do not reset control synchronization or flush audio.
  const armerListenKey = JSON.stringify([
    armerConfig.defaultListen,
    armerConfig.rules.map((r) => [r.id, r.max, r.listen]),
  ]);
  useEffect(() => {
    radio.current!.setArmerPolicy(armerConfig);
    if (settingsRef.current.decoder === "armer") audio.current!.clear();
  }, [armerListenKey]);
  useEffect(() => {
    const now = performance.now(),
      status = armerFeed.status;
    if (
      !active ||
      busy ||
      recordLocked ||
      recordIntent.current ||
      settings.decoder !== "armer" ||
      !settings.armerAutoCenter ||
      !status?.controlLocked ||
      now - armerReceivedAt.current > 1200
    ) {
      autoCenterTiming.current.observe(null, now);
      return;
    }
    const protectedCall = playing
      ? status.calls?.find(
          (c) =>
            c.selected &&
            c.encrypted === false &&
            c.talkgroup === status.audioTalkgroup &&
            listens(c.talkgroup, armerConfig),
        )
      : undefined;
    const proposal = chooseArmerCenter(
      settings.center,
      settings.channel,
      status.calls ?? [],
      armerConfig,
      protectedCall?.frequency,
    );
    const center = autoCenterTiming.current.observe(proposal, now);
    if (center === null) return;
    setBusy(true);
    void radio
      .current!.recenterArmer(center)
      .then(() => {
        audio.current!.clear();
        fft.current = null;
        setSettings((previous) => ({ ...previous, center }));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }, [
    armerFeed.status,
    active,
    busy,
    recordLocked,
    settings.decoder,
    settings.armerAutoCenter,
    settings.center,
    settings.channel,
    armerListenKey,
    playing,
  ]);
  useEffect(() => {
    setCenterInput(mhz(settings.center));
    setChannelInput(mhz(settings.channel));
  }, [settings.center, settings.channel]);

  async function apply(
    next: Settings,
    monitor: NfmMonitorConfig | null = null,
  ): Promise<boolean> {
    if (busy) return false;
    try {
      if (source === "replay")
        throw Error(
          "Stop replay before changing receiver or decoder settings.",
        );
      validateSettings(next);
      setReplayView(null);
      resetMeteor();
      if (active && settingsRef.current.decoder === "armer")
        autoCenterTiming.current.defer(performance.now());
      setError("");
      setBusy(true);
      if (active) await radio.current!.update(next, monitor);
      audio.current!.clear();
      setMetrics((m) => ({ ...m, stereo: false }));
      multiplex.current = null;
      setRds(null);
      setWwv(null);
      lastWwv.current = null;
      setWwvOrigin(active ? source : null);
      armerPending.current = [];
      armerStatus.current = null;
      setArmerFeed({ status: null, events: [] });
      setArmerGeneration((n) => n + 1);
      setArmerTest(source === "test");
      nfmPending.current = [];
      nfmStatus.current = null;
      setNfmFeed({ status: null, events: [] });
      setAppliedMonitor(monitor);
      setNfmTest(source === "test");
      rtlLatest.current = null;
      rtlPending.current = [];
      setRtlStatus(null);
      setRtlTest(source === "test");
      ookLatest.current = null;
      ookPending.current = [];
      setOokStatus(null);
      setOokTest(source === "test");
      radio.current!.setTestSpeed(next.decoder === "wwv" ? testSpeed : 1);
      if (
        !decoders
          .find((d) => d.id === next.decoder)
          ?.outputs.includes("audio") ||
        (source === "test" && next.decoder === "wwv" && testSpeed > 1)
      ) {
        audio.current!.pause();
        setPlaying(false);
      }
      if (next.center !== settingsRef.current.center) fft.current = null;
      setSettings(next);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function start(
    kind: "live" | "test",
    override?: Settings,
    monitor: NfmMonitorConfig | null = null,
  ): Promise<boolean> {
    if (busy) return false;
    setError("");
    setBusy(true);
    setFrozen(false);
    resetMeteor();
    setReplayView(null);
    autoCenterTiming.current.reset();
    fft.current = null;
    setMetrics(emptyMetrics);
    setWwv(null);
    lastWwv.current = null;
    setWwvOrigin(kind);
    setRds(null);
    setRdsTest(kind === "test");
    multiplex.current = null;
    armerPending.current = [];
    armerStatus.current = null;
    setArmerFeed({ status: null, events: [] });
    setArmerGeneration((n) => n + 1);
    setArmerTest(kind === "test");
    nfmPending.current = [];
    nfmStatus.current = null;
    setNfmFeed({ status: null, events: [] });
    setNfmTest(kind === "test");
    rtlLatest.current = null;
    rtlPending.current = [];
    setRtlStatus(null);
    setRtlTest(kind === "test");
    ookLatest.current = null;
    ookPending.current = [];
    setOokStatus(null);
    setOokTest(kind === "test");
    // A known source starts with known tuning; receiver settings remain otherwise intact.
    const current =
      override ??
      (kind === "live"
        ? {
            ...settingsRef.current,
            gain: rfDraft.auto ? null : rfDraft.gain,
            ppm: Number(rfDraft.ppm),
          }
        : settingsRef.current);
    const testProfile =
      current.decoder === "meteor"
        ? {
            center: 137750000,
            channel: 137900000,
            span: 600000,
            decoder: "meteor" as const,
          }
        : current.decoder === "rtl433"
          ? {
              center: 433750000,
              channel: 433920000,
              span: 600000,
              decoder: "rtl433" as const,
            }
          : current.decoder === "ook"
            ? {
                center: 433750000,
                channel: 433920000,
                span: 600000,
                decoder: "ook" as const,
              }
            : current.decoder === "nfm"
              ? {
                  center: 462400000,
                  channel: 462562500,
                  span: 600000,
                  decoder: "nfm" as const,
                }
              : current.decoder === "armer"
                ? {
                    center: 852400000,
                    channel: 853075000,
                    span: SAMPLE_RATE,
                    decoder: "armer" as const,
                  }
                : current.decoder === "wwv"
                  ? {
                      center: 25050000,
                      channel: 25000000,
                      span: 150000,
                      decoder: "wwv" as const,
                    }
                  : current.decoder === "am"
                    ? {
                        center: 120000000,
                        channel: 120100000,
                        span: 300000,
                        decoder: "am" as const,
                      }
                    : {
                        center: defaults.center,
                        channel: defaults.channel,
                        span: current.span,
                        decoder: "wfm" as const,
                      };
    const testManifest = decoders.find((d) => d.id === testProfile.decoder)!;
    const s =
      kind === "test" && !override
        ? {
            ...current,
            ...testProfile,
            bandwidth: testManifest.bandwidths.includes(current.bandwidth)
              ? current.bandwidth
              : testManifest.requirements.bandwidthHz,
          }
        : current;
    try {
      // connect() invokes the USB chooser before its first await.
      const starting =
        kind === "live"
          ? radio.current!.connect(s, monitor)
          : (radio.current!.setTestSpeed(s.decoder === "wwv" ? testSpeed : 1),
            radio.current!.test(s, monitor));
      await starting;
      setSettings(s);
      setSource(kind);
      setAppliedMonitor(monitor);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  function meteorBiasControl(command: MeteorBiasCommand) {
    if (source !== "replay") {
      if (command.action === "apply")
        setSettings((s) => ({
          ...s,
          meteor: { ...s.meteor, frequencyBiasHz: command.biasHz },
        }));
      if (command.action === "auto")
        setSettings((s) => ({
          ...s,
          meteor: { ...s.meteor, autoBias: command.enabled },
        }));
    }
    radio.current!.setMeteorBias(command);
  }
  async function startMeteorReplay(request: MeteorReplayRequest) {
    if (busy || active) return;
    setBusy(true);
    setError("");
    resetMeteor();
    setReplay(null);
    fft.current = null;
    setMetrics(emptyMetrics);
    audio.current!.pause();
    audio.current!.clear();
    setPlaying(false);
    setFrozen(false);
    try {
      await radio.current!.replay(
        request.file,
        request.source,
        request.settings,
        request.options,
      );
      setReplayView({
        settings: request.settings,
        sampleRate: request.source.sampleRate,
      });
      setSource("replay");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    setBusy(true);
    audio.current!.pause();
    setPlaying(false);
    await radio.current!.stop();
    flushRtl();
    if (ookLatest.current) setOokStatus(ookLatest.current);
    if (ookPending.current.length) {
      const captures = ookPending.current.splice(0);
      setOokCaptures((old) => [...old, ...captures].slice(-100));
    }
    setSource("idle");
    setAppliedMonitor(null);
    setBusy(false);
  }
  async function startRecording(mode: "disk" | "download", seconds: number) {
    if (recordPreparing || busy || !active) return;
    recordIntent.current = true;
    setError("");
    setRecordPreparing(true);
    const current = settingsRef.current,
      originalSource = sourceRef.current;
    const filename = captureName(
      current,
      originalSource === "test" ? "test" : "live",
    );
    let sink;
    try {
      // Invoke the directory picker in the original button gesture.
      sink =
        mode === "disk" ? await folderSink(filename) : downloadSink(filename);
      if (
        sourceRef.current !== originalSource ||
        settingsRef.current.center !== current.center
      )
        throw Error(
          "Receiver changed while choosing a folder. Start the recording again.",
        );
      radio.current!.startRecording(sink, seconds);
    } catch (error) {
      if (sink)
        try {
          await sink.abort();
        } catch {}
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      recordIntent.current = false;
      setRecordPreparing(false);
    }
  }
  async function toggleAudio() {
    if (playing) {
      audio.current!.pause();
      setPlaying(false);
      return;
    }
    setAudioBusy(true);
    try {
      await audio.current!.start();
      setPlaying(true);
    } catch (e) {
      setError(
        `Audio could not start: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setAudioBusy(false);
    }
  }
  const zoom = (factor: number) =>
    setSettings((s) => ({
      ...s,
      span: Math.round(
        Math.max(
          25000,
          Math.min(
            replayView?.sampleRate ?? SAMPLE_RATE,
            Math.min(s.span, replayView?.sampleRate ?? SAMPLE_RATE) * factor,
          ),
        ),
      ),
    }));
  const selectChannel = (channel: number) => {
    if (!busy) void apply({ ...settingsRef.current, channel });
  };
  const monitoredPreset = appliedMonitor?.presets.find(
    (p) => p.id === nfmFeed.status?.selectedId,
  );
  const inputRate = replayView?.sampleRate ?? SAMPLE_RATE;
  const displaySettings = replayView
    ? { ...replayView.settings, span: Math.min(settings.span, inputRate) }
    : monitoredPreset
      ? {
          ...settings,
          channel: monitoredPreset.frequency,
          bandwidth: monitoredPreset.bandwidth,
        }
      : settings;

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="/" aria-label="Spectrum home">
          <div className="brand-mark">
            <AudioLines size={25} strokeWidth={1.7} />
          </div>
          <span>
            Spectrum<span className="brand-sub">RTL-SDR ANALYZER</span>
          </span>
        </a>
        <div className="header-right">
          <span className="local-badge">
            <span /> All processing stays local
          </span>
          <AppAccess canUpdate={!active && !busy && !recordLocked} />
          <button
            className="icon-button help-button"
            onClick={() => setHelp(!help)}
            aria-expanded={help}
            aria-label="Receiver help"
          >
            <CircleHelp size={19} />
          </button>
        </div>
      </header>

      <main>
        <div className="page-heading">
          <div>
            <div className="eyebrow">THE RADIO SPECTRUM, IN YOUR BROWSER</div>
            <h1>Explore the airwaves.</h1>
            <p>Tune in, take a closer look, and decode what you find.</p>
          </div>
          <div className={`connection-pill ${active ? "connected" : ""}`}>
            <span />
            {busy
              ? "Applying…"
              : source === "live"
                ? "RTL-SDR connected"
                : source === "replay"
                  ? "Replaying local I/Q"
                  : source === "test"
                    ? "Generated test signal"
                    : "Receiver disconnected"}
          </div>
        </div>

        {error && (
          <div role="alert" className="error-banner">
            <span>{error}</span>
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={17} />
            </button>
          </div>
        )}
        {help && (
          <div className="help-panel">
            <div>
              <h2>Connect your RTL-SDR</h2>
              <p>
                Use Chrome or Edge on the computer connected to your RTL-SDR,
                close other SDR applications, then choose your receiver in the
                USB picker. Linux users can run{" "}
                <code>bash scripts/prepare-usb.sh</code> if the TV driver holds
                the interface.
              </p>
            </div>
            <div>
              <h2>Three independent controls</h2>
              <p>
                <strong>Center frequency</strong> tunes the hardware.{" "}
                <strong>Display span</strong> zooms within its 2.4 MHz capture.{" "}
                <strong>Decoder frequency</strong> selects a channel in that
                capture. Click the spectrum or use the frequency field. WFM
                automatically decodes stereo when a stable pilot is present,
                with a mono fallback for weak signals.
              </p>
            </div>
          </div>
        )}

        <div className="workspace">
          <section className="analyzer panel" aria-label="Spectrum analyzer">
            <div className="tuning-bar">
              <form
                className="center-tuner"
                onSubmit={(e) => {
                  e.preventDefault();
                  void apply(moveCenter(settings, Number(centerInput) * 1e6));
                }}
              >
                <label htmlFor="center">CENTER FREQUENCY</label>
                <div className="frequency-input">
                  <input
                    id="center"
                    type="number"
                    min="24"
                    max="1766"
                    step="0.0001"
                    value={
                      source === "replay" && replayView
                        ? mhz(replayView.settings.center)
                        : centerInput
                    }
                    onChange={(e) => setCenterInput(e.target.value)}
                    disabled={busy || source === "replay"}
                  />
                  <span>MHz</span>
                  <button
                    type="submit"
                    className="tune-button"
                    disabled={busy || source === "replay"}
                  >
                    Tune
                  </button>
                </div>
              </form>
              <div className="span-control">
                <label htmlFor="span">DISPLAY SPAN</label>
                <div className="span-input">
                  <button
                    className="icon-button"
                    aria-label="Zoom in"
                    onClick={() => zoom(0.5)}
                    disabled={displaySettings.span <= 25000}
                  >
                    <Minus size={15} />
                  </button>
                  <div className="select-wrap">
                    <select
                      id="span"
                      value={displaySettings.span}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          span: Number(e.target.value),
                        }))
                      }
                    >
                      {[
                        ...new Set([
                          SAMPLE_RATE,
                          1200000,
                          600000,
                          300000,
                          150000,
                          75000,
                          25000,
                          displaySettings.span,
                          inputRate,
                        ]),
                      ]
                        .filter((v) => v <= inputRate)
                        .sort((a, b) => b - a)
                        .map((v) => (
                          <option key={v} value={v}>
                            {spanLabel(v)}
                          </option>
                        ))}
                    </select>
                    <ChevronDown size={13} />
                  </div>
                  <button
                    className="icon-button"
                    aria-label="Zoom out"
                    onClick={() => zoom(2)}
                    disabled={displaySettings.span >= inputRate}
                  >
                    <Plus size={15} />
                  </button>
                </div>
              </div>
            </div>
            <Spectrum
              data={fft}
              sampleRate={inputRate}
              settings={displaySettings}
              source={source}
              floor={floor}
              frozen={frozen}
              peakHold={peakHold}
              onChannel={selectChannel}
              onFreeze={() => setFrozen(!frozen)}
              onReset={() => setFrozen(false)}
            />
            <div className="plot-footer">
              <span>
                <span className="trace-dot" />
                {frozen
                  ? "View frozen · reception continues"
                  : active
                    ? source === "replay"
                      ? `Recorded I/Q · ${(inputRate / 1e6).toFixed(4)} MSPS`
                      : source === "test"
                        ? settings.decoder === "meteor"
                          ? "Generated noise · acquisition test, no satellite imagery"
                          : settings.decoder === "wwv"
                            ? `Synthetic WWV IQ · ${testSpeed}×`
                            : settings.decoder === "rtl433"
                              ? "Generated rtl_433 IQ · OOK + FSK devices"
                              : settings.decoder === "ook"
                                ? "Generated OOK / ASK IQ · PWM test payload A6"
                                : settings.decoder === "nfm"
                                  ? "Generated NFM IQ · scheduled FRS test calls"
                                  : settings.decoder === "armer"
                                    ? "Generated P25 IQ · test vocoder data"
                                    : settings.decoder === "am"
                                      ? "Synthetic AM IQ · 1 kHz tone + adjacent station"
                                      : "Synthetic IQ · L 1 kHz / R 2 kHz"
                        : "Live IQ stream"
                    : metrics.samples
                      ? "Stopped · last received spectrum"
                      : "Waiting for receiver"}
              </span>
              <span>
                8,192 FFT <b>·</b> 293 Hz / bin
              </span>
            </div>
            <div className="display-options">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={peakHold}
                  onChange={(e) => setPeakHold(e.target.checked)}
                />{" "}
                Peak hold
              </label>
              <label className="floor-control">
                Display floor{" "}
                <input
                  aria-label="Display floor"
                  type="range"
                  min="-120"
                  max="-60"
                  step="5"
                  value={floor}
                  onChange={(e) => setFloor(Number(e.target.value))}
                />
                <span>{floor} dBFS</span>
              </label>
              <span className="spectrum-hint">
                Click spectrum to tune decoder
              </span>
            </div>
            {settings.decoder === "meteor" && (
              <Suspense
                fallback={<p className="caption">Loading Meteor controls…</p>}
              >
                <MeteorPanel
                  settings={settings}
                  status={meteorStatus}
                  images={meteorImages}
                  constellation={meteorConstellation}
                  source={source}
                  busy={busy}
                  replay={replay}
                  onReplay={startMeteorReplay}
                  onBiasControl={meteorBiasControl}
                  onApply={(meteor, frequency) =>
                    apply({
                      ...settings,
                      meteor,
                      ...(frequency === undefined
                        ? {}
                        : { channel: frequency, center: frequency - 150000 }),
                    })
                  }
                />
              </Suspense>
            )}
            {settings.decoder === "wwv" && (
              <WwvPanel
                status={wwv}
                active={active}
                test={wwvOrigin === "test"}
                testSpeed={testSpeed}
              />
            )}
            {multiplexEnabled && (
              <MultiplexSpectrumView
                data={multiplex}
                active={active}
                test={source === "test"}
              />
            )}
            {settings.decoder === "wfm" && (
              <RdsPanel
                status={rds}
                enabled={settings.rds}
                active={active}
                test={rdsTest}
              />
            )}
            {settings.decoder === "rtl433" && (
              <Rtl433Panel
                status={rtlStatus}
                protocols={rtlProtocols}
                messages={rtlMessages}
                options={settings.rtl433}
                active={active}
                test={rtlTest}
                busy={busy}
                onApply={(rtl433) => void apply({ ...settings, rtl433 })}
                onClear={() => {
                  rtlPending.current = [];
                  setRtlMessages([]);
                }}
              />
            )}
            {settings.decoder === "ook" && (
              <OokPanel
                status={ookStatus}
                captures={ookCaptures}
                options={settings.ook}
                active={active}
                test={ookTest}
                busy={busy}
                onApply={(ook) => apply({ ...settings, ook })}
                onClear={() => {
                  ookPending.current = [];
                  setOokCaptures([]);
                }}
              />
            )}
            {settings.decoder === "nfm" && (
              <NfmPanel
                status={nfmFeed.status}
                active={active}
                test={nfmTest}
              />
            )}
            {settings.decoder === "armer" && (
              <ArmerPanel
                playing={playing}
                config={armerConfig}
                onChange={setArmerConfig}
                feed={armerFeed}
                generation={armerGeneration}
                test={armerTest}
                active={active}
                control={settings.channel}
                onTune={(hz) =>
                  void apply({
                    ...settings,
                    center: hz - 675000,
                    channel: hz,
                    span: SAMPLE_RATE,
                  })
                }
              />
            )}
          </section>

          <aside className="sidebar">
            <section className="panel receiver-panel">
              <div className="panel-title">
                <h2>
                  <Usb size={17} /> Receiver
                </h2>
                <span className="chip">WEBUSB</span>
              </div>
              <div className="receiver-details">
                <div className="device-icon">
                  <Radio size={24} />
                </div>
                <div>
                  <strong>RTL-SDR</strong>
                  <span>RTL2832U · R820T / R828D</span>
                </div>
              </div>
              <div className="capture-row">
                <span>Capture rate</span>
                <strong>
                  {(inputRate / 1e6).toFixed(inputRate === SAMPLE_RATE ? 1 : 4)}{" "}
                  <small>MSPS</small>
                </strong>
              </div>
              <p className="caption">
                {replayView
                  ? "Recorded sample rate."
                  : "Fixed acquisition rate."}{" "}
                Display span and decoder bandwidth are independent.
              </p>
              {active ? (
                <button
                  className="button stop-button"
                  disabled={busy}
                  onClick={() => void stop()}
                >
                  <Square size={15} fill="currentColor" /> Stop{" "}
                  {source === "replay"
                    ? "replay"
                    : source === "test"
                      ? "test signal"
                      : "receiver"}
                </button>
              ) : (
                <>
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => void start("live")}
                  >
                    <Power size={17} />
                    {busy ? "Connecting…" : "Connect RTL-SDR"}
                  </button>
                  <button
                    className="button test-button"
                    disabled={busy}
                    onClick={() => void start("test")}
                  >
                    <FlaskConical size={15} />{" "}
                    {settings.decoder === "meteor"
                      ? "Try Meteor noise test signal"
                      : settings.decoder === "rtl433"
                        ? "Try rtl_433 test signal"
                        : settings.decoder === "ook"
                          ? "Try OOK / ASK test signal"
                          : settings.decoder === "nfm"
                            ? "Try NFM test signal"
                            : settings.decoder === "armer"
                              ? "Try ARMER test signal"
                              : settings.decoder === "wwv"
                                ? "Try WWV test signal"
                                : settings.decoder === "am"
                                  ? "Try AM test signal"
                                  : "Try FM test signal"}
                  </button>
                </>
              )}
            </section>

            <section className="panel decoder-panel">
              <div className="panel-title">
                <h2>
                  <AudioLines size={18} /> Decode as…
                </h2>
                <span className="chip wasm-chip">WASM</span>
              </div>
              <label className="field-label" htmlFor="decoder">
                Decoder
              </label>
              <div className="select-wrap full">
                <select
                  id="decoder"
                  value={settings.decoder}
                  disabled={busy || source === "replay"}
                  onChange={(e) => {
                    const decoder = e.target.value as Settings["decoder"];
                    const manifest = decoders.find((d) => d.id === decoder)!;
                    void apply({
                      ...settings,
                      decoder,
                      bandwidth:
                        decoder === "none"
                          ? settings.bandwidth
                          : manifest.requirements.bandwidthHz,
                      ...(decoder === "meteor"
                        ? {
                            center: 137750000,
                            channel: 137900000,
                            span: 600000,
                          }
                        : decoder === "wwv"
                          ? {
                              center: 25050000,
                              channel: 25000000,
                              span: 150000,
                            }
                          : decoder === "armer"
                            ? {
                                center: armerConfig.controls[0] - 675000,
                                channel: armerConfig.controls[0],
                                span: SAMPLE_RATE,
                              }
                            : {}),
                    });
                  }}
                >
                  {decoders.map((d) => (
                    <option
                      key={d.id}
                      value={d.id}
                      disabled={!!compatibility(d)}
                      title={compatibility(d) ?? undefined}
                    >
                      {d.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={15} />
              </div>
              <p className="decoder-description">
                {decoders.find((d) => d.id === settings.decoder)?.description}
              </p>
              {settings.decoder === "am" && (
                <p className="caption" style={{ marginBottom: 16 }}>
                  Current tuner path: 24–1766 MHz. Selecting AM preserves your
                  tuned frequency.
                </p>
              )}
              <fieldset
                disabled={
                  settings.decoder === "none" || busy || source === "replay"
                }
                className="decoder-fields"
              >
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void apply({
                      ...settings,
                      channel: Number(channelInput) * 1e6,
                    });
                  }}
                >
                  <label className="field-label" htmlFor="channel">
                    {appliedMonitor
                      ? monitoredPreset
                        ? "Selected audio frequency"
                        : "Bank reference frequency"
                      : settings.decoder === "armer"
                        ? "Control frequency"
                        : "Decoder frequency"}
                  </label>
                  <div className="channel-input">
                    <input
                      id="channel"
                      type="number"
                      step="0.0001"
                      value={
                        appliedMonitor
                          ? mhz(displaySettings.channel)
                          : channelInput
                      }
                      readOnly={!!appliedMonitor}
                      onChange={(e) => setChannelInput(e.target.value)}
                    />
                    <span>MHz</span>
                    <button
                      type="submit"
                      aria-label="Tune decoder"
                      disabled={!!appliedMonitor}
                    >
                      Set
                    </button>
                  </div>
                </form>
                <div className="two-fields">
                  <div>
                    <label className="field-label" htmlFor="bandwidth">
                      Channel width
                    </label>
                    <div className="select-wrap full">
                      <select
                        id="bandwidth"
                        disabled={!!appliedMonitor}
                        value={displaySettings.bandwidth}
                        onChange={(e) =>
                          void apply({
                            ...settings,
                            bandwidth: Number(e.target.value),
                          })
                        }
                      >
                        {(decoders.find((d) => d.id === settings.decoder)
                          ?.bandwidths.length
                          ? decoders.find((d) => d.id === settings.decoder)!
                              .bandwidths
                          : [settings.bandwidth]
                        ).map((v) => (
                          <option key={v} value={v}>
                            {v / 1000} kHz
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={13} />
                    </div>
                  </div>
                  {settings.decoder === "wfm" && (
                    <div>
                      <label className="field-label" htmlFor="deemphasis">
                        De-emphasis
                      </label>
                      <div className="select-wrap full">
                        <select
                          id="deemphasis"
                          value={settings.deemphasis}
                          onChange={(e) =>
                            void apply({
                              ...settings,
                              deemphasis: Number(e.target.value),
                            })
                          }
                        >
                          <option value="75">75 µs · US</option>
                          <option value="50">50 µs · EU</option>
                          <option value="0">Off</option>
                        </select>
                        <ChevronDown size={13} />
                      </div>
                    </div>
                  )}
                </div>
                {settings.decoder === "wfm" && (
                  <div className="mode-field">
                    <label className="field-label" htmlFor="audio-mode">
                      Audio mode
                    </label>
                    <div className="select-wrap full">
                      <select
                        id="audio-mode"
                        disabled={busy}
                        value={settings.stereo ? "auto" : "mono"}
                        onChange={(e) => {
                          const stereo = e.target.value === "auto";
                          radio.current!.setWfmStereo(stereo);
                          setSettings((previous) => ({ ...previous, stereo }));
                        }}
                      >
                        <option value="auto">
                          Auto stereo · mono fallback
                        </option>
                        <option value="mono">Mono · force mono output</option>
                      </select>
                      <ChevronDown size={13} />
                    </div>
                  </div>
                )}
                {settings.decoder === "wfm" && (
                  <button
                    className={`button multiplex-toggle ${multiplexOpen ? "active" : ""}`}
                    aria-expanded={multiplexOpen}
                    aria-controls="multiplex-spectrum"
                    onClick={() => setMultiplexOpen((open) => !open)}
                  >
                    <Activity size={15} /> Multiplex spectrum
                    <ChevronDown size={14} />
                  </button>
                )}
                {settings.decoder === "wfm" && (
                  <label className="checkbox-label rds-toggle">
                    <input
                      type="checkbox"
                      checked={settings.rds}
                      disabled={busy}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        radio.current!.setWfmRds(enabled);
                        setRds(null);
                        setSettings((previous) => ({
                          ...previous,
                          rds: enabled,
                        }));
                      }}
                    />
                    Decode RDS/RBDS
                  </label>
                )}
                {settings.decoder === "nfm" && (
                  <div className="nfm-controls">
                    <SquelchSelect
                      value={
                        monitoredPreset
                          ? monitoredPreset.squelch
                          : settings.squelch
                      }
                      onChange={(squelch) =>
                        void apply({ ...settings, squelch })
                      }
                      disabled={busy || !!appliedMonitor}
                    />
                    <label className="preset-field">
                      FM deviation
                      <select
                        aria-label="FM deviation"
                        value={
                          monitoredPreset?.deviation ?? settings.nfmDeviation
                        }
                        disabled={busy || !!appliedMonitor}
                        onChange={(e) =>
                          void apply({
                            ...settings,
                            nfmDeviation: Number(e.target.value),
                          })
                        }
                      >
                        {[2500, 5000, 7500].map((v) => (
                          <option key={v} value={v}>
                            ±{v / 1000} kHz
                          </option>
                        ))}
                      </select>
                    </label>
                    <ToneSelect
                      value={
                        monitoredPreset ? monitoredPreset.tone : settings.tone
                      }
                      onChange={(tone) => void apply({ ...settings, tone })}
                      disabled={busy || !!appliedMonitor}
                    />
                    <p className="caption">
                      {appliedMonitor
                        ? "Edit per-channel settings in the preset bank below."
                        : "300–3,200 Hz voice audio · 750 µs de-emphasis. Codes are detected even with Any code selected."}
                    </p>
                  </div>
                )}
                {settings.decoder === "wwv" && (
                  <div className="wwv-controls">
                    <label className="field-label">WWV carrier presets</label>
                    <div className="wwv-presets">
                      {wwvFrequencies.map((hz) => (
                        <button
                          key={hz}
                          disabled={busy || hz < receiverCapabilities.minHz}
                          title={
                            hz < receiverCapabilities.minHz
                              ? "Below this tuner's 24 MHz minimum; needs HF hardware or an upconverter"
                              : "Tune WWV 25 MHz"
                          }
                          onClick={() =>
                            void apply({
                              ...settings,
                              center: hz + 50000,
                              channel: hz,
                              span: 150000,
                            })
                          }
                        >
                          {hz / 1e6} MHz
                        </button>
                      ))}
                    </div>
                    <p className="caption">
                      25 MHz fits this tuner. Lower WWV frequencies need
                      HF-capable hardware or an upconverter. The 25 MHz
                      broadcast is experimental.
                    </p>
                    <label className="field-label" htmlFor="test-speed">
                      WWV test speed
                    </label>
                    <div className="select-wrap full">
                      <select
                        id="test-speed"
                        value={testSpeed}
                        onChange={(e) => {
                          const speed = Number(e.target.value);
                          setTestSpeed(speed);
                          radio.current!.setTestSpeed(speed);
                          if (source === "test" && speed > 1) {
                            audio.current!.pause();
                            setPlaying(false);
                          }
                        }}
                      >
                        <option value="16">
                          16× · time-code test, muted audio
                        </option>
                        <option value="1">
                          1× · real-time test with audio
                        </option>
                      </select>
                      <ChevronDown size={13} />
                    </div>
                  </div>
                )}
                {settings.decoder === "armer" && (
                  <div className="wwv-controls">
                    <label className="checkbox-label armer-auto-center">
                      <input
                        type="checkbox"
                        aria-label="Auto-center active talkgroups"
                        checked={settings.armerAutoCenter}
                        onChange={(e) =>
                          setSettings((previous) => ({
                            ...previous,
                            armerAutoCenter: e.target.checked,
                          }))
                        }
                      />
                      Auto-center active talkgroups
                    </label>
                    <p className="caption">
                      {recordLocked && settings.armerAutoCenter
                        ? "Auto-centering paused while recording IQ."
                        : "Fits more enabled voice channels alongside the control channel. Channels too far apart cannot share the 2.4 MHz capture. Retunes can briefly interrupt audio."}
                    </p>
                    <label className="field-label">
                      Saved control frequencies
                    </label>
                    <div className="wwv-presets">
                      {armerConfig.controls.map((hz) => (
                        <button
                          key={hz}
                          onClick={() =>
                            void apply({
                              ...settings,
                              center: hz - 675000,
                              channel: hz,
                              span: SAMPLE_RATE,
                            })
                          }
                        >
                          {(hz / 1e6).toFixed(4)} MHz
                        </button>
                      ))}
                    </div>
                    <p className="caption">
                      Tune a site's control channel. Voice grants are followed
                      inside the hardware capture, independently of display
                      zoom.
                    </p>
                    <button
                      type="button"
                      className="button rf-apply"
                      onClick={() =>
                        setArmerConfig((c) => ({
                          ...c,
                          controls: [
                            ...new Set([settings.channel, ...c.controls]),
                          ].slice(0, 32),
                        }))
                      }
                    >
                      Save current control frequency
                    </button>
                  </div>
                )}
              </fieldset>
              <div className="audio-section">
                <div
                  className={`stereo-status ${active && metrics.stereo ? "locked" : ""}`}
                  role="status"
                >
                  <span>Output</span>
                  <strong>
                    {!active || settings.decoder === "none"
                      ? "—"
                      : settings.decoder === "meteor"
                        ? "Satellite images · LRPT"
                        : settings.decoder === "rtl433"
                          ? "Device messages · JSON"
                          : settings.decoder === "ook"
                            ? "Pulse timings + interpreted data"
                            : settings.decoder === "nfm"
                              ? "Mono · narrowband FM"
                              : settings.decoder === "armer"
                                ? "Mono · P25 IMBE"
                                : settings.decoder === "wwv"
                                  ? "Mono · AM voice + time code"
                                  : settings.decoder === "am"
                                    ? "Mono · AM envelope"
                                    : !settings.stereo
                                      ? "Mono · forced"
                                      : metrics.stereo
                                        ? "Stereo · pilot locked"
                                        : "Mono · awaiting stereo pilot"}
                  </strong>
                </div>
                <button
                  className={`button ${playing ? "audio-playing" : "audio-button"}`}
                  onClick={() => void toggleAudio()}
                  disabled={
                    !active ||
                    !decoders
                      .find((d) => d.id === settings.decoder)
                      ?.outputs.includes("audio") ||
                    busy ||
                    audioBusy ||
                    (source === "test" &&
                      settings.decoder === "wwv" &&
                      testSpeed > 1)
                  }
                >
                  {playing ? (
                    <Square size={14} fill="currentColor" />
                  ) : (
                    <Headphones size={17} />
                  )}
                  {audioBusy
                    ? "Starting audio…"
                    : playing
                      ? "Pause audio"
                      : "Play audio"}
                  {playing && (
                    <span className="audio-animation">
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                </button>
                <div className="volume-control">
                  <Volume2 size={16} />
                  <input
                    aria-label="Audio volume"
                    type="range"
                    min="0"
                    max="100"
                    value={volume}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setVolume(v);
                      audio.current!.setVolume(v / 100);
                    }}
                  />
                  <span>{volume}%</span>
                </div>
                <span className="audio-caption">
                  {settings.decoder === "meteor"
                    ? "Image decoder · inspect satellite channels below the spectrum"
                    : settings.decoder === "rtl433"
                      ? "Data decoder · inspect device messages below the spectrum"
                      : settings.decoder === "ook"
                        ? "Data decoder · inspect captured bursts below the spectrum"
                        : source === "test" &&
                            settings.decoder === "wwv" &&
                            testSpeed > 1
                          ? "Switch the WWV test to 1× to hear audio"
                          : playing
                            ? `48 kHz PCM · ${metrics.stereo ? "stereo" : "mono"} · ${source === "test" ? "generated test tones" : settings.decoder.toUpperCase()}`
                            : "Audio starts only when you press play"}
                </span>
              </div>
            </section>

            <section className="panel rf-panel">
              <div className="panel-title">
                <h2>
                  <SlidersHorizontal size={17} /> RF settings
                </h2>
              </div>
              <div className="gain-heading">
                <label htmlFor="gain">Tuner gain</label>
                <strong>
                  {rfDraft.auto ? "Auto" : `${rfDraft.gain.toFixed(1)} dB`}
                </strong>
              </div>
              <input
                id="gain"
                className="gain-slider"
                type="range"
                min="0"
                max="49.6"
                step="0.1"
                value={rfDraft.gain}
                disabled={busy || rfDraft.auto}
                onChange={(e) =>
                  setRfDraft((s) => ({ ...s, gain: Number(e.target.value) }))
                }
              />
              <div className="gain-ends">
                <span>0 dB</span>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={rfDraft.auto}
                    disabled={busy}
                    onChange={(e) =>
                      setRfDraft((s) => ({ ...s, auto: e.target.checked }))
                    }
                  />{" "}
                  Auto gain
                </label>
                <span>49.6 dB</span>
              </div>
              <div className="ppm-row">
                <label htmlFor="ppm">Frequency correction</label>
                <div>
                  <input
                    id="ppm"
                    type="number"
                    min="-200"
                    max="200"
                    value={rfDraft.ppm}
                    disabled={busy}
                    onChange={(e) =>
                      setRfDraft((s) => ({ ...s, ppm: e.target.value }))
                    }
                  />
                  <span>ppm</span>
                </div>
              </div>
              <button
                className="button rf-apply"
                disabled={busy || !rfPending}
                onClick={() =>
                  void apply(
                    {
                      ...settings,
                      gain: rfDraft.auto ? null : rfDraft.gain,
                      ppm: Number(rfDraft.ppm),
                    },
                    appliedMonitor,
                  )
                }
              >
                Apply RF settings
              </button>
              <p
                className={`caption ${rfPending ? "warning-text" : ""}`}
                data-testid="applied-rf-settings"
              >
                {source === "live" ? "Applied" : "Saved"}:{" "}
                {settings.gain === null
                  ? "Auto gain"
                  : `${settings.gain.toFixed(1)} dB`}{" "}
                · {settings.ppm} ppm{rfPending ? " · Pending RF changes" : ""}
              </p>
              <p className="caption">
                Bias tee off. Gain rounds to a supported hardware step.
              </p>
            </section>

            <IqRecordingPanel
              state={recording}
              active={active && source !== "replay"}
              busy={busy}
              preparing={recordPreparing}
              onStart={startRecording}
              onStop={() => radio.current!.stopRecording()}
              onClear={() => radio.current!.clearRecording()}
            />
          </aside>

          <PresetPanel
            settings={settings}
            source={source === "replay" ? "idle" : source}
            busy={busy || recordLocked}
            scanPaused={recordLocked}
            feed={nfmFeed}
            generation={armerGeneration}
            applied={appliedMonitor}
            onTune={(p) => apply(presetSettings(p, settingsRef.current))}
            onMonitor={(monitor, center) => {
              const p = monitor.presets[0];
              const next = {
                ...presetSettings(p, settingsRef.current),
                center,
                span: SAMPLE_RATE,
              };
              return active
                ? apply(next, monitor)
                : start(
                    "live",
                    {
                      ...next,
                      gain: rfDraft.auto ? null : rfDraft.gain,
                      ppm: Number(rfDraft.ppm),
                    },
                    monitor,
                  );
            }}
            onStopMonitor={() => {
              const selected =
                appliedMonitor?.presets.find(
                  (p) => p.id === nfmFeed.status?.selectedId,
                ) ?? appliedMonitor?.presets[0];
              return apply(
                selected
                  ? presetSettings(selected, settingsRef.current)
                  : settingsRef.current,
              );
            }}
            onHold={(id) => {
              radio.current!.setNfmHold(id);
              audio.current!.clear();
              setAppliedMonitor((c) => (c ? { ...c, holdId: id } : null));
            }}
          />

          <section
            className="signal-strip panel"
            aria-label="Signal measurements"
          >
            <div className="signal-strip-heading">
              <Activity size={18} />
              <span>Signal monitor</span>
              <small>
                {active
                  ? source === "test"
                    ? "TEST SOURCE"
                    : "RECEIVING"
                  : "IDLE"}
              </small>
            </div>
            <div className="measurement">
              <span>Input power</span>
              <strong>
                {active && metrics.samples ? metrics.rms.toFixed(1) : "—"}{" "}
                <small>dBFS</small>
              </strong>
            </div>
            <div className="measurement">
              <span>ADC clipping</span>
              <strong
                className={active && metrics.clipping > 1 ? "warning-text" : ""}
              >
                {active && metrics.samples ? metrics.clipping.toFixed(2) : "—"}{" "}
                <small>%</small>
              </strong>
            </div>
            <div className="measurement">
              <span>DSP processing</span>
              <strong>
                {active && metrics.samples ? Math.round(metrics.cpu) : "—"}{" "}
                <small>% of block time</small>
              </strong>
            </div>
            <div className="measurement">
              <span>Worker backlog</span>
              <strong>
                {active ? metrics.backlog : "—"} <small>blocks</small>
              </strong>
            </div>
          </section>
        </div>
        <footer className="app-footer">
          <span>
            <Cpu size={14} /> WebUSB + WebAssembly + Web Audio
          </span>
          <span>
            Power is relative dBFS, not calibrated dBm.{" "}
            <span className="footer-divider">/</span> {AUDIO_RATE / 1000} kHz
            audio · {((FFT_SIZE / SAMPLE_RATE) * 1000).toFixed(2)} ms FFT window
          </span>
        </footer>
      </main>
    </div>
  );
}
