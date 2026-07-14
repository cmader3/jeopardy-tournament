import { useCallback, useEffect, useRef, useState } from 'react';

export type CueType = 'armed' | 'timeUp' | 'finalThink';

export interface UseBoardAudioResult {
  muted: boolean;
  toggleMute: () => void;
  playCue: (cue: CueType) => void;
  setThinkMusic: (active: boolean) => void;
}

// An original, looping "think" motif synthesized with the Web Audio API.
// This is not the copyrighted Jeopardy theme; it is a generic game-show-style
// countdown loop. To swap in a licensed track later, replace the scheduler in
// useBoardAudio with an HTMLAudioElement pointed at a file in client/public.
const THINK_STEP_SECONDS = 0.3;
const THINK_SCHEDULE_AHEAD_SECONDS = 0.2;
const THINK_SCHEDULER_INTERVAL_MS = 40;

const THINK_MELODY_HZ: number[] = [
  293.66, 440.0, 587.33, 440.0,
  349.23, 440.0, 587.33, 659.25,
  349.23, 523.25, 698.46, 523.25,
  329.63, 392.0, 493.88, 587.33,
];

const THINK_BASS_HZ: Array<number | null> = [
  73.42, null, null, null,
  73.42, null, null, null,
  87.31, null, null, null,
  82.41, null, null, null,
];

function scheduleThinkNote(
  ctx: AudioContext,
  freq: number,
  startTime: number,
  duration: number,
  type: OscillatorType,
  peak: number,
): void {
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(peak, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);
  osc.connect(gain);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.05);
}

const MUTE_KEY = 'jeopardy-board-muted';

function readMutedPreference(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeMutedPreference(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, String(muted));
  } catch {
    // ignore storage failure
  }
}

function isAudioContextSupported(): boolean {
  return typeof AudioContext !== 'undefined';
}

function playArmedCue(ctx: AudioContext): void {
  const t = ctx.currentTime;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, t);
  osc.frequency.setValueAtTime(1100, t + 0.08);
  osc.connect(gain);
  osc.start(t);
  osc.stop(t + 0.18);
}

function playTimeUpCue(ctx: AudioContext): void {
  const t = ctx.currentTime;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.48);

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(440, t);
  osc.frequency.exponentialRampToValueAtTime(220, t + 0.5);
  osc.connect(gain);
  osc.start(t);
  osc.stop(t + 0.5);
}

function playFinalThinkCue(ctx: AudioContext): void {
  const t = ctx.currentTime;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.2, t + 0.05);
  gain.gain.setValueAtTime(0.2, t + 0.7);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);

  const osc1 = ctx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(523.25, t);
  osc1.connect(gain);
  osc1.start(t);
  osc1.stop(t + 1.0);

  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(659.25, t);
  osc2.connect(gain);
  osc2.start(t);
  osc2.stop(t + 1.0);
}

function playCueNow(ctx: AudioContext, cue: CueType): void {
  switch (cue) {
    case 'armed':
      playArmedCue(ctx);
      break;
    case 'timeUp':
      playTimeUpCue(ctx);
      break;
    case 'finalThink':
      playFinalThinkCue(ctx);
      break;
  }
}

export function useBoardAudio(): UseBoardAudioResult {
  const [muted, setMuted] = useState(readMutedPreference);
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const ctxRef = useRef<AudioContext | null>(null);
  const pendingRef = useRef<CueType[]>([]);

  const thinkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const thinkStepRef = useRef(0);
  const thinkNextNoteTimeRef = useRef(0);
  const thinkActiveRef = useRef(false);

  const ensureContext = useCallback((): AudioContext | null => {
    if (!isAudioContextSupported()) return null;
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext();
    }
    return ctxRef.current;
  }, []);

  const flushPending = useCallback((ctx: AudioContext) => {
    while (pendingRef.current.length > 0) {
      const cue = pendingRef.current.shift();
      if (cue) playCueNow(ctx, cue);
    }
  }, []);

  const playCue = useCallback(
    (cue: CueType) => {
      if (muted) return;
      const ctx = ensureContext();
      if (!ctx) {
        pendingRef.current.push(cue);
        return;
      }
      if (ctx.state !== 'running') {
        pendingRef.current.push(cue);
        return;
      }
      playCueNow(ctx, cue);
    },
    [muted, ensureContext],
  );

  const thinkTick = useCallback(() => {
    if (!thinkActiveRef.current || mutedRef.current) return;
    const ctx = ctxRef.current;
    if (!ctx || ctx.state !== 'running') return;

    if (thinkNextNoteTimeRef.current < ctx.currentTime) {
      thinkNextNoteTimeRef.current = ctx.currentTime + 0.05;
    }

    while (thinkNextNoteTimeRef.current < ctx.currentTime + THINK_SCHEDULE_AHEAD_SECONDS) {
      const step = thinkStepRef.current;
      const t = thinkNextNoteTimeRef.current;
      const melody = THINK_MELODY_HZ[step];
      if (melody) scheduleThinkNote(ctx, melody, t, THINK_STEP_SECONDS * 0.9, 'triangle', 0.13);
      const bass = THINK_BASS_HZ[step];
      if (bass) scheduleThinkNote(ctx, bass, t, THINK_STEP_SECONDS * 3.6, 'sine', 0.16);
      thinkNextNoteTimeRef.current = t + THINK_STEP_SECONDS;
      thinkStepRef.current = (step + 1) % THINK_MELODY_HZ.length;
    }
  }, []);

  const setThinkMusic = useCallback(
    (active: boolean) => {
      thinkActiveRef.current = active;
      if (active) {
        const ctx = ensureContext();
        if (!ctx) return;
        if (ctx.state !== 'running') {
          void ctx.resume().catch(() => {});
        }
        if (thinkIntervalRef.current == null) {
          thinkStepRef.current = 0;
          thinkNextNoteTimeRef.current = 0;
          thinkIntervalRef.current = setInterval(thinkTick, THINK_SCHEDULER_INTERVAL_MS);
        }
        thinkTick();
      } else if (thinkIntervalRef.current != null) {
        clearInterval(thinkIntervalRef.current);
        thinkIntervalRef.current = null;
      }
    },
    [ensureContext, thinkTick],
  );

  useEffect(() => {
    return () => {
      if (thinkIntervalRef.current != null) {
        clearInterval(thinkIntervalRef.current);
        thinkIntervalRef.current = null;
      }
    };
  }, []);

  const toggleMute = useCallback(() => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    writeMutedPreference(nextMuted);
    const ctx = ensureContext();
    if (ctx && ctx.state !== 'closed') {
      void ctx.resume().then(() => {
        if (!mutedRef.current) {
          flushPending(ctx);
        }
      });
    }
  }, [muted, ensureContext, flushPending]);

  // When the AudioContext becomes available/running, flush any cues that were queued before
  // a user gesture (e.g., the initial armed event before the board was interacted with).
  useEffect(() => {
    if (muted) return;
    const ctx = ensureContext();
    if (!ctx) return;

    const handleStateChange = () => {
      if (mutedRef.current) return;
      if (ctx.state === 'running') {
        flushPending(ctx);
      }
    };

    handleStateChange();
    ctx.addEventListener('statechange', handleStateChange);
    return () => {
      ctx.removeEventListener('statechange', handleStateChange);
    };
  }, [muted, ensureContext, flushPending]);

  return { muted, toggleMute, playCue, setThinkMusic };
}
