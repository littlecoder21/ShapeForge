import { useEffect, useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { Section, Seg, ValueControl } from '../../shared/controls';
import { useStore } from '../engine/store';
import { saveBlob } from '../export/download';
import { animationInfo, bitrateFor, estimateBytes, exportSlug, formatBytes, formatSeconds, resolveBackground, resolveSizes, videoTiming } from '../export/exportPlan';
import { MAX_VIDEO_SIDE, loadVideoSettings, saveVideoSettings, type VideoFormat, type VideoSettings } from '../export/exportTypes';
import { isAbort } from '../export/frameCapture';
import { runVideoExport, type VideoExportResult, type VideoProgress } from '../export/runVideoExport';
import { probeCodecs, webCodecsAvailable, type VideoCodecId } from '../export/videoEncode';
import { BackgroundControls, Chips, Field, FramePreview, ProgressBar, SizeControls } from './ExportControls';
import { useStudio } from './ui';

const FORMATS: { id: VideoFormat; label: string }[] = [{ id: 'mp4', label: 'MP4' }, { id: 'webm', label: 'WebM' }, { id: 'gif', label: 'GIF' }, { id: 'frames', label: 'Frames' }];
const FPS_CHOICES: Record<VideoFormat, number[]> = { mp4: [24, 25, 30, 50, 60], webm: [24, 25, 30, 50, 60], gif: [10, 12, 15, 20, 25], frames: [12, 24, 30, 60] };
const FORMAT_HINT: Record<VideoFormat, string> = {
  mp4: 'H.264 video that plays everywhere (social media, phones, editors).',
  webm: 'Open web video: smaller files, ideal for website backgrounds.',
  gif: 'Looping animated picture, limited to 256 colours.',
  frames: 'One image per frame in a ZIP, for video editors and 3D tools.',
};

/** Video export: MP4 / WebM through the browser's encoder, GIF, or numbered frame sequences, with size, timing and quality control. */
export default function VideoExportPanel() {
  const { store, announce } = useStudio();
  const project = useStore(store, state => state.project);
  const [settings, setSettings] = useState<VideoSettings>(loadVideoSettings);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<VideoProgress | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<VideoExportResult | null>(null);
  const [resultUrl, setResultUrl] = useState('');
  const [support, setSupport] = useState<Record<VideoCodecId, boolean> | null>(null);
  const [previewNotes, setPreviewNotes] = useState<string[]>([]);
  const controller = useRef<AbortController | null>(null);
  const lastPaint = useRef(0);

  useEffect(() => { saveVideoSettings(settings); }, [settings]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!result) { setResultUrl(''); return; }
    const url = URL.createObjectURL(result.blob);
    setResultUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [result]);
  const update = (patch: Partial<VideoSettings>) => setSettings(current => ({ ...current, ...patch }));

  const info = useMemo(() => animationInfo(project), [project]);
  const video = settings.format === 'mp4' || settings.format === 'webm';
  const size = useMemo(() => resolveSizes(project.canvas, settings.size, { even: video, maxSide: MAX_VIDEO_SIDE, single: true })[0], [project.canvas, settings.size, video]);
  const timing = useMemo(() => videoTiming(settings, info), [settings, info]);
  const alpha = settings.format === 'gif' || (settings.format === 'frames' && settings.framesType !== 'jpeg');
  const background = resolveBackground(project, settings.background, alpha);
  const slug = exportSlug(project, settings.fileName);
  const frames = !info.dynamic && !video ? 1 : timing.frames;
  const bytes = estimateBytes(settings, size, timing, info.dynamic);
  const bitrate = bitrateFor(size.width, size.height, timing.fps, settings.qualityPreset, settings.bitrateMbps);
  const tooBig = size.width * size.height > 100_000_000;
  const hasEncoder = webCodecsAvailable();

  useEffect(() => {
    if (!video || !hasEncoder) return;
    let cancelled = false;
    const timer = window.setTimeout(() => { void probeCodecs(size.width, size.height, timing.fps).then(found => { if (!cancelled) setSupport(found); }); }, 150);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [video, hasEncoder, size.width, size.height, timing.fps]);

  const codec: VideoCodecId = settings.format === 'mp4' ? 'avc' : settings.webmCodec;
  const unsupported = video && (!hasEncoder || (support !== null && !support[codec]));

  const chooseFormat = (format: VideoFormat) => {
    const allowed = FPS_CHOICES[format];
    update({ format, fps: allowed.includes(settings.fps) ? settings.fps : format === 'gif' ? 15 : 30 });
  };

  const start = async () => {
    const ac = new AbortController();
    controller.current = ac;
    setBusy(true);
    setError('');
    setResult(null);
    setProgress(null);
    try {
      const exported = await runVideoExport(store.getState().project, settings, {
        signal: ac.signal,
        onProgress: next => {
          const now = performance.now();
          if (next.phase !== 'rendering' || now - lastPaint.current > 120 || next.frame === next.total) { lastPaint.current = now; setProgress(next); }
        },
      });
      setResult(exported);
      saveBlob(exported.fileName, exported.blob);
      announce(`Saved ${exported.fileName} · ${formatBytes(exported.blob.size)}`);
    } catch (failure) {
      if (isAbort(failure)) announce('Export cancelled');
      else setError(failure instanceof Error ? failure.message : 'The export failed.');
    } finally {
      setBusy(false);
      setProgress(null);
      controller.current = null;
    }
  };

  const codecOption = (id: VideoCodecId, label: string) => ({ id: id as string, label, disabled: support !== null && !support[id] });
  const notes = [...new Set([...(result?.notes ?? []), ...previewNotes])];
  const fadeMax = Math.max(0, Math.floor(timing.seconds * 500));
  const percent = progress ? progress.total ? progress.frame / progress.total : 0 : 0;

  return <div className="gs-output xp" data-testid="video-export-panel">
    <div className="xp-head">
      <b>Video export</b>
      <small>{size.width}×{size.height} · {timing.fps} fps · {formatSeconds(frames / timing.fps)} · {frames} frame{frames === 1 ? '' : 's'}</small>
    </div>
    <Seg value={settings.format} label="Video format" onChange={chooseFormat} options={FORMATS} testId="video-format" />
    <small className="xp-hint">{FORMAT_HINT[settings.format]}</small>
    {!info.dynamic && <div className="gs-note" role="note">Nothing in this project moves yet. {video ? 'The still image is held for the chosen length.' : 'A single image is exported.'} Switch on Animate in the Animate tab or enable a shader layer to record motion.</div>}
    {video && !hasEncoder && <div className="xp-failure" role="alert">This browser has no video encoder (WebCodecs). Use Chrome, Edge, Safari 16.4+ or Firefox 130+, or export a GIF or frames.</div>}
    <div className="xp-cols">
      <FramePreview project={project} background={background} time={Math.min(settings.start, timing.seconds)} dynamic={info.dynamic}
        width={project.canvas.w} height={project.canvas.h} fit="stretch" disabled={busy} onNotes={setPreviewNotes} />
      <div className="xp-options">
        {settings.format === 'webm' && <Section title="Codec" hint={settings.webmCodec.toUpperCase()}>
          <Seg value={settings.webmCodec as string} label="WebM codec" onChange={value => update({ webmCodec: value as VideoSettings['webmCodec'] })}
            options={[codecOption('vp9', 'VP9'), codecOption('vp8', 'VP8'), codecOption('av1', 'AV1')]} />
          <small className="xp-hint">VP9 is the best all-round choice; AV1 is smallest but slow to encode; VP8 is the most compatible.</small>
        </Section>}
        {settings.format === 'frames' && <Section title="Image type" hint={settings.framesType.toUpperCase()}>
          <Seg value={settings.framesType} label="Frame image type" onChange={framesType => update({ framesType })} options={[{ id: 'png', label: 'PNG' }, { id: 'jpeg', label: 'JPEG' }, { id: 'webp', label: 'WebP' }]} />
          {settings.framesType !== 'png' && <ValueControl label="Image quality" value={settings.imageQuality} min={1} max={100} step={1} unit="%" def={92} onChange={imageQuality => update({ imageQuality })} />}
          <ValueControl label="Number digits" value={settings.digits} min={1} max={8} step={1} def={4} onChange={digits => update({ digits })} />
        </Section>}
        <Section title="Size" hint={`${size.width}×${size.height}`}>
          <SizeControls size={settings.size} onChange={next => update({ size: next })} canvas={project.canvas} multi={false} maxSide={MAX_VIDEO_SIDE} />
          {video && <small className="xp-hint">Video sizes are rounded to even numbers.</small>}
          {tooBig && <small className="xp-error">That is more than 100 megapixels: choose a smaller size.</small>}
        </Section>
        <Section title="Timing" hint={`${timing.fps} fps · ${formatSeconds(timing.seconds)}`}>
          <Field label="Frame rate"><Chips value={settings.fps} label="Frames per second" options={FPS_CHOICES[settings.format].map(fps => ({ id: fps, label: `${fps}` }))} onChange={fps => update({ fps })} /></Field>
          <Field label="Length">
            <Seg value={settings.durationMode} label="Length" onChange={durationMode => update({ durationMode })} options={[{ id: 'auto', label: `Auto · ${formatSeconds(timing.seconds)}` }, { id: 'custom', label: 'Custom' }]} />
          </Field>
          {settings.durationMode === 'custom' && <ValueControl label="Duration" value={settings.duration} min={0.5} max={120} step={0.1} unit="s" def={6} onChange={duration => update({ duration })} />}
          {settings.durationMode === 'auto' && <small className="xp-hint">{info.finiteMs !== null ? 'Length of the animation.' : info.loopMs !== null ? 'One full loop of the endless animation.' : info.shader ? 'A short clip of the shader motion.' : 'A short hold of the still image.'}</small>}
          {info.dynamic && <>
            <ValueControl label="Start at" value={settings.start} min={0} max={120} step={0.1} unit="s" def={0} onChange={start => update({ start })} />
            <ValueControl label="Speed" value={settings.speed} min={0.25} max={4} step={0.05} unit="×" def={1} onChange={speed => update({ speed })} />
          </>}
        </Section>
        {video && <Section title="Quality" hint={settings.qualityPreset === 'custom' ? `${settings.bitrateMbps} Mbps` : settings.qualityPreset}>
          <Seg value={settings.qualityPreset} label="Quality" onChange={qualityPreset => update({ qualityPreset })} options={[{ id: 'low', label: 'Low' }, { id: 'medium', label: 'Medium' }, { id: 'high', label: 'High' }, { id: 'max', label: 'Max' }, { id: 'custom', label: 'Custom' }]} />
          {settings.qualityPreset === 'custom' && <ValueControl label="Bitrate" value={settings.bitrateMbps} min={0.5} max={120} step={0.5} unit=" Mbps" def={12} onChange={bitrateMbps => update({ bitrateMbps })} />}
          <small className="xp-hint">About {(bitrate / 1e6).toFixed(1)} Mbps. Smooth gradients band at low bitrates, so High is the recommended default.</small>
          <Field label="Rate control"><Seg value={settings.bitrateMode} label="Rate control" onChange={bitrateMode => update({ bitrateMode })} options={[{ id: 'variable', label: 'Variable' }, { id: 'constant', label: 'Constant' }]} /></Field>
          <ValueControl label="Keyframe every" value={settings.keyframeSeconds} min={0.5} max={10} step={0.5} unit="s" def={2} onChange={keyframeSeconds => update({ keyframeSeconds })} />
          <Field label="Encoder"><Seg value={settings.hardware} label="Encoder" onChange={hardware => update({ hardware })} options={[{ id: 'no-preference', label: 'Auto' }, { id: 'prefer-hardware', label: 'Hardware' }, { id: 'prefer-software', label: 'Software' }]} /></Field>
        </Section>}
        {settings.format === 'gif' && <Section title="GIF options" hint={`${settings.gifColors} colours`}>
          <Field label="Colours"><Chips value={settings.gifColors} label="Palette size" options={[32, 64, 128, 256].map(count => ({ id: count, label: `${count}` }))} onChange={gifColors => update({ gifColors })} /></Field>
          <Field label="Dithering" hint="Dithering hides colour banding in gradients. Ordered stays steady between frames; Floyd–Steinberg looks smoothest on stills.">
            <Seg value={settings.gifDither} label="Dithering" onChange={gifDither => update({ gifDither })} options={[{ id: 'none', label: 'None' }, { id: 'ordered', label: 'Ordered' }, { id: 'floyd', label: 'Floyd–Steinberg' }]} />
          </Field>
          {info.dynamic && <Field label="Loop"><Seg value={settings.gifPlays === 0 ? 'forever' : settings.gifPlays === 1 ? 'once' : 'many'} label="Loop" onChange={value => update({ gifPlays: value === 'forever' ? 0 : value === 'once' ? 1 : 3 })}
            options={[{ id: 'forever', label: 'Forever' }, { id: 'once', label: 'Once' }, { id: 'many', label: '3 times' }]} /></Field>}
        </Section>}
        <Section title="Appearance" hint={settings.background.mode}>
          <BackgroundControls value={settings.background} onChange={value => update({ background: value })}
            alphaNote={alpha ? 'Used when you choose Solid colour. GIF keeps single-colour transparency.' : 'MP4 and WebM have no transparency: transparent areas are filled with this colour.'} />
          {info.dynamic && <>
            <ValueControl label="Fade in" value={settings.fadeIn} min={0} max={fadeMax} step={50} unit=" ms" def={0} onChange={fadeIn => update({ fadeIn })} />
            <ValueControl label="Fade out" value={settings.fadeOut} min={0} max={fadeMax} step={50} unit=" ms" def={0} onChange={fadeOut => update({ fadeOut })} />
          </>}
        </Section>
        <Section title="File" open={false}>
          <Field label="File name" hint="Size and format are added automatically."><input className="xp-input" value={settings.fileName} placeholder={slug} maxLength={80} onChange={event => update({ fileName: event.target.value })} aria-label="File name" /></Field>
        </Section>
      </div>
    </div>
    <div className="xp-summary" data-testid="video-summary">
      <span><b>{size.width}×{size.height}</b>size</span>
      <span><b>{frames}</b>frames</span>
      <span><b>{formatSeconds(frames / timing.fps)}</b>length</span>
      <span><b>≈ {formatBytes(bytes)}</b>file</span>
    </div>
    {info.shader && <small className="xp-hint">Shader time is stepped frame by frame, so the result does not depend on how fast this computer renders. Keep this tab open and in front while exporting.</small>}
    {notes.length > 0 && <div className="gs-note" role="note">{notes.join(' · ')}</div>}
    {error && <div className="xp-failure" role="alert">{error}</div>}
    {unsupported && hasEncoder && <div className="xp-failure" role="alert">This browser cannot encode {settings.format === 'mp4' ? 'H.264' : settings.webmCodec.toUpperCase()} at {size.width}×{size.height}. Choose another codec or a smaller size.</div>}
    {busy && <ProgressBar value={percent} label={progress?.message ?? 'Preparing…'} detail={progress && progress.phase === 'rendering' ? `${Math.round(percent * 100)}%${progress.etaMs !== null ? ` · about ${formatSeconds(progress.etaMs / 1000)} left` : ''}` : undefined} />}
    <div className="gs-copyrow xp-actions">
      {busy
        ? <button type="button" className="btn" onClick={() => controller.current?.abort()} data-testid="video-cancel">Cancel</button>
        : <button type="button" className="btn primary" disabled={tooBig || unsupported} onClick={() => { void start(); }} data-testid="video-export"><Download />Export {settings.format === 'frames' ? 'frames (ZIP)' : settings.format.toUpperCase()}</button>}
    </div>
    <small className="xp-hint">Closing this panel cancels an export in progress.</small>
    {result && !busy && <div className="xp-result" data-testid="video-result">
      <b>Saved {result.fileName}</b>
      <span>{result.width}×{result.height} · {result.frames} frames · {formatSeconds(result.seconds)} · {formatBytes(result.blob.size)}{result.codec ? ` · ${result.codec}` : ''}</span>
      {resultUrl && (result.fileName.endsWith('.gif') ? <img className="xp-media" src={resultUrl} alt="Exported animation" /> : !result.fileName.endsWith('.zip') && <video className="xp-media" src={resultUrl} controls loop muted playsInline />)}
      <button type="button" className="btn small" onClick={() => saveBlob(result.fileName, result.blob)}><Download />Download again</button>
    </div>}
  </div>;
}
