import { useCallback, useEffect, useRef, useState } from 'react';

export type CueType = 'armed' | 'timeUp' | 'finalThink';

export interface UseBoardAudioResult {
  muted: boolean;
  toggleMute: () => void;
  playCue: (cue: CueType) => void;
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

  return { muted, toggleMute, playCue };
}
