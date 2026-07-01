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
  });

  registerGameSockets(io, engine);

  return io;
}
