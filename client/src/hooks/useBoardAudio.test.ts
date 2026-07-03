import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBoardAudio } from './useBoardAudio.js';

function createMockAudioContext() {
  const oscillators: Array<{ connect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; frequency: { setValueAtTime: ReturnType<typeof vi.fn> } }> = [];
  const gainNodes: Array<{ connect: ReturnType<typeof vi.fn>; gain: { setValueAtTime: ReturnType<typeof vi.fn>; linearRampToValueAtTime: ReturnType<typeof vi.fn> } }> = [];

  const createOscillator = vi.fn(() => {
    const osc = {
      connect: vi.fn((node) => node),
      start: vi.fn(),
      stop: vi.fn(),
      frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    };
    oscillators.push(osc);
    return osc;
  });

  const createGain = vi.fn(() => {
    const gain = {
      connect: vi.fn((node) => node),
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
    };
    gainNodes.push(gain);
    return gain;
  });

  const destination = { name: 'destination' } as unknown as AudioDestinationNode;
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  const addEventListener = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
    let set = listeners.get(type);
    if (!set) {
      set = new Set();
      listeners.set(type, set);
    }
    set.add(listener);
  });

  const removeEventListener = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
    listeners.get(type)?.delete(listener);
  });

  const dispatchStateChange = () => {
    const event = new Event('statechange');
    listeners.get('statechange')?.forEach((listener) => {
      if (typeof listener === 'function') {
        listener(event);
      } else {
        listener.handleEvent?.(event);
      }
    });
  };

  const resume = vi.fn().mockImplementation(() => {
    ctx.state = 'running';
    dispatchStateChange();
    return Promise.resolve(undefined);
  });

  const ctx = {
    state: 'running' as AudioContextState,
    resume,
    createOscillator,
    createGain,
    destination,
    currentTime: 0,
    addEventListener,
    removeEventListener,
  } as unknown as AudioContext & { dispatchStateChange: () => void; state: AudioContextState };
  ctx.dispatchStateChange = dispatchStateChange;

  function MockAudioContextFn() {
    return ctx;
  }
  const MockAudioContext = vi.fn(MockAudioContextFn);

  return { ctx, MockAudioContext, oscillators, gainNodes, createOscillator, createGain };
}

describe('useBoardAudio', () => {
  let audioContextMock: ReturnType<typeof createMockAudioContext> | null = null;

  beforeEach(() => {
    localStorage.clear();
    audioContextMock = createMockAudioContext();
    Object.defineProperty(globalThis, 'AudioContext', {
      value: audioContextMock!.MockAudioContext,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'AudioContext', {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });

  it('initializes with audio unmuted', () => {
    const { result } = renderHook(() => useBoardAudio());
    expect(result.current.muted).toBe(false);
  });

  it('restores muted preference from localStorage', () => {
    localStorage.setItem('jeopardy-board-muted', 'true');
    const { result } = renderHook(() => useBoardAudio());
    expect(result.current.muted).toBe(true);
  });

  it('toggles mute and persists the new state', () => {
    const { result } = renderHook(() => useBoardAudio());

    act(() => {
      result.current.toggleMute();
    });

    expect(result.current.muted).toBe(true);
    expect(localStorage.getItem('jeopardy-board-muted')).toBe('true');

    act(() => {
      result.current.toggleMute();
    });

    expect(result.current.muted).toBe(false);
    expect(localStorage.getItem('jeopardy-board-muted')).toBe('false');
  });

  it('creates an AudioContext and resumes it on toggle', () => {
    const { result } = renderHook(() => useBoardAudio());

    act(() => {
      result.current.toggleMute();
    });

    expect(globalThis.AudioContext).toHaveBeenCalledTimes(1);
    expect(audioContextMock!.ctx.resume).toHaveBeenCalledTimes(1);
  });

  it('plays the armed cue by creating oscillator nodes', () => {
    const { result } = renderHook(() => useBoardAudio());

    act(() => {
      result.current.playCue('armed');
    });

    expect(audioContextMock!.createOscillator).toHaveBeenCalled();
    expect(audioContextMock!.createGain).toHaveBeenCalled();
    expect(audioContextMock!.oscillators.length).toBeGreaterThan(0);
  });

  it('plays the time-up cue by creating oscillator nodes', () => {
    const { result } = renderHook(() => useBoardAudio());

    act(() => {
      result.current.playCue('timeUp');
    });

    expect(audioContextMock!.createOscillator).toHaveBeenCalled();
    expect(audioContextMock!.createGain).toHaveBeenCalled();
  });

  it('plays the final-think cue by creating oscillator nodes', () => {
    const { result } = renderHook(() => useBoardAudio());

    act(() => {
      result.current.playCue('finalThink');
    });

    expect(audioContextMock!.createOscillator).toHaveBeenCalled();
    expect(audioContextMock!.createGain).toHaveBeenCalled();
  });

  it('does not create audio nodes when muted', () => {
    const { result } = renderHook(() => useBoardAudio());

    act(() => {
      result.current.toggleMute();
    });

    act(() => {
      result.current.playCue('armed');
    });

    expect(audioContextMock!.createOscillator).not.toHaveBeenCalled();
    expect(audioContextMock!.createGain).not.toHaveBeenCalled();
  });

  it('queues cues when the AudioContext is suspended and flushes them after resume', async () => {
    audioContextMock!.ctx.state = 'suspended';
    const { result } = renderHook(() => useBoardAudio());

    act(() => {
      result.current.playCue('armed');
    });

    expect(audioContextMock!.createOscillator).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.toggleMute();
    });

    expect(audioContextMock!.createOscillator).toHaveBeenCalled();
  });

  it('degrades gracefully when AudioContext is unavailable', () => {
    Object.defineProperty(globalThis, 'AudioContext', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useBoardAudio());

    act(() => {
      result.current.playCue('armed');
    });

    expect(result.current.muted).toBe(false);
  });
});
