import { GameState } from '../models/index.js';

export interface ReducerCtx {
  now: number;
  random?: () => number;
}

export function reduce(state: GameState, _intent: unknown, _ctx: ReducerCtx): GameState {
  return state;
}
