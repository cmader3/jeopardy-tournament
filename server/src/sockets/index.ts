import { Server } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { GameEngine } from '../engine/game.js';
import { registerGameSockets } from './game.js';

export function bootstrapSocketIO(httpServer: HttpServer, engine: GameEngine = new GameEngine()) {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:4100',
      credentials: true,
    },
    // Recover session/rooms and buffered events across brief drops so a quick
    // network blip does not force a full rejoin.
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: true,
    },
    // Be tolerant of flaky mobile connections before declaring a socket dead.
    pingInterval: 25000,
    pingTimeout: 30000,
  });

  registerGameSockets(io, engine);

  return io;
}
