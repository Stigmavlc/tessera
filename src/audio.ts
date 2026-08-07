// All sound lives here: a synthesized turn-timer tick (no asset needed) and a
// small looping music player for `public/audio/lobby.mp3` / `table.mp3`.
// Everything is gated by the "Table sounds" setting and degrades to silence
// when audio is unavailable (missing files, blocked autoplay, no AudioContext).

let context: AudioContext | null = null;

const ensureContext = (): AudioContext | null => {
  if (!context) {
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
  }
  if (context.state === "suspended") void context.resume();
  return context;
};

// A clock tick: a short band-passed square blip, alternating tick/tock pitch.
// urgency 0..1 raises the volume as the turn timer runs out.
export function playTick(urgency: number, alternate: boolean) {
  const ctx = ensureContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const level = 0.05 + 0.3 * Math.min(1, Math.max(0, urgency));

  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.value = alternate ? 1140 : 880;

  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = alternate ? 1200 : 940;
  filter.Q.value = 7;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(level, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.07);
}

// A soft ceramic click for a tile landing on the table.
export function playTilePlace() {
  const ctx = ensureContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const length = Math.floor(ctx.sampleRate * 0.05);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / length) ** 2;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 2600;
  const gain = ctx.createGain();
  gain.gain.value = 0.22;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start(now);
}

export type MusicTrack = "lobby" | "table";

const MUSIC_VOLUME = 0.1;
const FADE_MS = 1200;

let musicElement: HTMLAudioElement | null = null;
let musicGain: GainNode | null = null;
let currentTrack: MusicTrack | null = null;
let switchTimer: number | null = null;
const unavailable = new Set<MusicTrack>();

const trackUrl = (track: MusicTrack) => `${import.meta.env.BASE_URL}audio/${track}.mp3`;

const clearSwitch = () => {
  if (switchTimer !== null) {
    window.clearTimeout(switchTimer);
    switchTimer = null;
  }
};

// iOS ignores writes to HTMLMediaElement.volume, so all fading happens on a
// Web Audio gain node instead, and every fade completes on the clock — never
// by reading a volume back.
const ensureMusicGraph = (element: HTMLAudioElement): GainNode | null => {
  const ctx = ensureContext();
  if (!ctx) return null;
  if (!musicGain) {
    const source = ctx.createMediaElementSource(element);
    musicGain = ctx.createGain();
    musicGain.gain.value = 0;
    source.connect(musicGain);
    musicGain.connect(ctx.destination);
  }
  return musicGain;
};

const rampMusic = (target: number, onDone?: () => void) => {
  clearSwitch();
  if (musicGain && context) {
    const now = context.currentTime;
    musicGain.gain.cancelScheduledValues(now);
    musicGain.gain.setValueAtTime(musicGain.gain.value, now);
    musicGain.gain.linearRampToValueAtTime(target, now + FADE_MS / 1000);
  } else if (musicElement) {
    try {
      musicElement.volume = target;
    } catch {
      // Some platforms refuse element volume control entirely.
    }
  }
  if (onDone) switchTimer = window.setTimeout(onDone, FADE_MS + 40);
};

// Switches the looping background track (or stops it with `null`). Safe to
// call repeatedly; the first call after a user click unlocks playback.
export function setMusic(track: MusicTrack | null, enabled: boolean) {
  const desired = enabled ? track : null;

  if (desired === null) {
    if (musicElement && currentTrack !== null) {
      const element = musicElement;
      rampMusic(0, () => element.pause());
    }
    currentTrack = null;
    return;
  }

  if (unavailable.has(desired)) return;
  if (desired === currentTrack && musicElement && !musicElement.paused) {
    ensureContext();
    return;
  }

  const begin = () => {
    const element = musicElement ?? new Audio();
    musicElement = element;
    element.loop = true;
    element.src = trackUrl(desired);
    element.onerror = () => {
      unavailable.add(desired);
      if (currentTrack === desired) currentTrack = null;
    };
    const gain = ensureMusicGraph(element);
    if (!gain) element.volume = MUSIC_VOLUME;
    element.play().then(() => {
      rampMusic(MUSIC_VOLUME);
    }).catch(() => {
      // Autoplay blocked — the next user-gesture-driven call will succeed.
      if (currentTrack === desired) currentTrack = null;
    });
    currentTrack = desired;
  };

  clearSwitch();
  if (musicElement && currentTrack !== null && !musicElement.paused) {
    const element = musicElement;
    rampMusic(0, () => {
      element.pause();
      begin();
    });
    currentTrack = desired;
  } else {
    begin();
  }
}
