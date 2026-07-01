import { Server } from 'socket.io';
import type { Server as HttpServer } from 'node:http';

export function bootstrapSocketIO(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:4100',
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    console.log('socket connected', socket.id);

    socket.on('disconnect', () => {
      console.log('socket disconnected', socket.id);
    });
  });

  return io;
}
