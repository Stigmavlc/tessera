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

export type MusicTrack = "lobby" | "table";

const MUSIC_VOLUME = 0.4;
const FADE_MS = 900;

let musicElement: HTMLAudioElement | null = null;
let currentTrack: MusicTrack | null = null;
let fadeTimer: number | null = null;
const unavailable = new Set<MusicTrack>();

const trackUrl = (track: MusicTrack) => `${import.meta.env.BASE_URL}audio/${track}.mp3`;

const fadeTo = (element: HTMLAudioElement, target: number, onDone?: () => void) => {
  if (fadeTimer !== null) window.clearInterval(fadeTimer);
  const stepMs = 60;
  const step = (target - element.volume) / (FADE_MS / stepMs);
  fadeTimer = window.setInterval(() => {
    const next = element.volume + step;
    const done = step >= 0 ? next >= target : next <= target;
    element.volume = done ? target : next;
    if (done) {
      if (fadeTimer !== null) window.clearInterval(fadeTimer);
      fadeTimer = null;
      onDone?.();
    }
  }, stepMs);
};

// Switches the looping background track (or stops it with `null`). Safe to
// call repeatedly; must first be called after a user gesture for autoplay.
export function setMusic(track: MusicTrack | null, enabled: boolean) {
  const desired = enabled ? track : null;

  if (desired === null) {
    if (musicElement && currentTrack !== null) {
      const element = musicElement;
      fadeTo(element, 0, () => element.pause());
    }
    currentTrack = null;
    return;
  }

  if (unavailable.has(desired)) return;
  if (desired === currentTrack && musicElement && !musicElement.paused) return;

  const start = () => {
    const element = musicElement ?? new Audio();
    musicElement = element;
    element.loop = true;
    element.src = trackUrl(desired);
    element.volume = 0;
    element.onerror = () => {
      unavailable.add(desired);
      if (currentTrack === desired) currentTrack = null;
    };
    element.play().then(() => fadeTo(element, MUSIC_VOLUME)).catch(() => {
      // Autoplay blocked — the next user-gesture-driven call will succeed.
      if (currentTrack === desired) currentTrack = null;
    });
    currentTrack = desired;
  };

  if (musicElement && currentTrack !== null && !musicElement.paused) {
    const element = musicElement;
    fadeTo(element, 0, () => {
      element.pause();
      start();
    });
  } else {
    start();
  }
}
