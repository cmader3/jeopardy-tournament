import { useCallback, useEffect, useRef, useState } from 'react';

export type CueType = 'armed' | 'timeUp' | 'finalThink';

export interface UseBoardAudioResult {
  muted: boolean;
  toggleMute: () => void;
  playCue: (cue: CueType) => void;
  setThinkMusic: (active: boolean) => void;
  playWinnerMusic: () => void;
}

// Looping "think" music played from a file in client/public during the clue
// and Final countdowns. Drop an MP3 at client/public/think-music.mp3 to use
// your own track; if the file is absent, playback simply stays silent.
const THINK_MUSIC_SRC = '/think-music.mp3';
const THINK_MUSIC_VOLUME = 0.5;

// One-shot fanfare played a single time when the winner screen appears. Drop an
// MP3 at client/public/winner-music.mp3 to use your own track; if the file is
// absent, playback simply stays silent.
const WINNER_MUSIC_SRC = '/winner-music.mp3';
const WINNER_MUSIC_VOLUME = 0.6;

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

function isAudioElementSupported(): boolean {
  return typeof Audio !== 'undefined';
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

  const thinkAudioRef = useRef<HTMLAudioElement | null>(null);
  const thinkActiveRef = useRef(false);

  const winnerAudioRef = useRef<HTMLAudioElement | null>(null);

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

  const ensureThinkAudio = useCallback((): HTMLAudioElement | null => {
    if (!isAudioElementSupported()) return null;
    if (!thinkAudioRef.current) {
      const audio = new Audio(THINK_MUSIC_SRC);
      audio.loop = true;
      audio.volume = THINK_MUSIC_VOLUME;
      audio.preload = 'auto';
      thinkAudioRef.current = audio;
    }
    return thinkAudioRef.current;
  }, []);

  const stopThinkAudio = useCallback((audio: HTMLAudioElement, reset: boolean) => {
    try {
      audio.pause();
      if (reset) audio.currentTime = 0;
    } catch {
      // ignore playback control failures
    }
  }, []);

  // Drive the looping think music toward the desired state (playing only when
  // active and unmuted). Unlike a fire-and-forget play(), this reconciles: a
  // play() that is rejected (autoplay/suspension gating, or an interrupted
  // start) is recovered later by the user-gesture / visibility listeners
  // below, and if the desired state flips while playback is starting the
  // resolved promise stops it. This keeps the music reliable across game
  // restarts, tab backgrounding, and rapid phase transitions.
  const reconcileThinkMusic = useCallback((mutedOverride?: boolean) => {
    const isMuted = mutedOverride ?? mutedRef.current;
    const wantPlaying = thinkActiveRef.current && !isMuted;
    if (!wantPlaying) {
      const existing = thinkAudioRef.current;
      if (existing) stopThinkAudio(existing, !thinkActiveRef.current);
      return;
    }
    const audio = ensureThinkAudio();
    if (!audio) return;
    try {
      const result = audio.play();
      if (result && typeof result.then === 'function') {
        result.then(
          () => {
            if (!(thinkActiveRef.current && !mutedRef.current)) {
              stopThinkAudio(audio, !thinkActiveRef.current);
            }
          },
          () => {
            // Blocked or interrupted. Recovery happens on the next user gesture
            // or when the tab becomes visible again (listeners below); do not
            // retry synchronously or a persistently blocked play() would loop.
          },
        );
      }
    } catch {
      // Ignore synchronous play failures; recovery is handled by the listeners.
    }
  }, [ensureThinkAudio, stopThinkAudio]);

  const setThinkMusic = useCallback(
    (active: boolean) => {
      thinkActiveRef.current = active;
      // Create the element eagerly (even while muted/inactive) so it is ready
      // to play the instant a clue is armed.
      ensureThinkAudio();
      reconcileThinkMusic();
    },
    [ensureThinkAudio, reconcileThinkMusic],
  );

  // Recover think music on the next user gesture or when the board tab becomes
  // visible again. A gesture also satisfies the browser autoplay policy, so a
  // loop that was blocked on the first arm starts as soon as the host interacts
  // with the page; visibility covers resuming after the tab was backgrounded.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleGesture = () => reconcileThinkMusic();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') reconcileThinkMusic();
    };
    document.addEventListener('pointerdown', handleGesture);
    document.addEventListener('keydown', handleGesture);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('pointerdown', handleGesture);
      document.removeEventListener('keydown', handleGesture);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [reconcileThinkMusic]);

  const ensureWinnerAudio = useCallback((): HTMLAudioElement | null => {
    if (!isAudioElementSupported()) return null;
    if (!winnerAudioRef.current) {
      const audio = new Audio(WINNER_MUSIC_SRC);
      audio.loop = false;
      audio.volume = WINNER_MUSIC_VOLUME;
      audio.preload = 'auto';
      winnerAudioRef.current = audio;
    }
    return winnerAudioRef.current;
  }, []);

  const stopWinnerMusic = useCallback(() => {
    const audio = winnerAudioRef.current;
    if (!audio) return;
    try {
      audio.pause();
    } catch {
      // ignore playback control failures
    }
  }, []);

  const playWinnerMusic = useCallback(() => {
    if (mutedRef.current) return;
    const audio = ensureWinnerAudio();
    if (!audio) return;
    try {
      audio.currentTime = 0;
      const result = audio.play();
      if (result && typeof result.catch === 'function') {
        result.catch(() => {});
      }
    } catch {
      // Autoplay blocked before a user gesture, or unsupported (e.g., jsdom).
    }
  }, [ensureWinnerAudio]);

  useEffect(() => {
    return () => {
      const audio = thinkAudioRef.current;
      if (audio) {
        stopThinkAudio(audio, true);
        thinkAudioRef.current = null;
      }
      const winner = winnerAudioRef.current;
      if (winner) {
        stopWinnerMusic();
        winnerAudioRef.current = null;
      }
    };
  }, [stopThinkAudio, stopWinnerMusic]);

  const toggleMute = useCallback(() => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    writeMutedPreference(nextMuted);

    // Pass the new mute state explicitly: mutedRef is only synced after render,
    // and the cue-flush path below intentionally relies on that lag.
    reconcileThinkMusic(nextMuted);

    // The winner fanfare is a one-shot: muting stops it, but unmuting does not
    // restart it.
    if (nextMuted) {
      stopWinnerMusic();
    }

    const ctx = ensureContext();
    if (ctx && ctx.state !== 'closed') {
      void ctx.resume().then(() => {
        if (!mutedRef.current) {
          flushPending(ctx);
        }
      });
    }
  }, [muted, ensureContext, flushPending, reconcileThinkMusic, stopWinnerMusic]);

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

  return { muted, toggleMute, playCue, setThinkMusic, playWinnerMusic };
}
