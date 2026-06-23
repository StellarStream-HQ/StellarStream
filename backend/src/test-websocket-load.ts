import { io, Socket } from 'socket.io-client';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const DEFAULT_COUNT = 100;
const argCount = parseInt(process.argv[2] || process.env.COUNT || `${DEFAULT_COUNT}`, 10);
const CONNECT_INTERVAL_MS = 5; // stagger connections to avoid bursts

console.log(`Starting load test: connecting ${argCount} clients to ${SERVER_URL}`);

const sockets: Socket[] = [];
let connected = 0;
let disconnected = 0;

function makeAddress(i: number) {
  return `GDTESTUSER${String(i).padStart(12, '0')}ABCDEFGHIJKLMNO`;
}

async function startClients(count: number) {
  for (let i = 0; i < count; i++) {
    await new Promise((r) => setTimeout(r, CONNECT_INTERVAL_MS));
    const socket = io(SERVER_URL, { transports: ['websocket'], reconnection: false });

    socket.on('connect', () => {
      connected += 1;
      const addr = makeAddress(i);
      socket.emit('join-stream-room', addr);
    });

    socket.on('disconnect', () => {
      disconnected += 1;
    });

    socket.on('server-ping', () => {
      socket.emit('client-pong');
    });

    sockets.push(socket);
  }
}

startClients(argCount).then(() => {
  console.log('All clients initiated');
  const statsInterval = setInterval(() => {
    console.log(`Clients created: ${sockets.length} | connected: ${connected} | disconnected: ${disconnected}`);
    const mem = process.memoryUsage();
    console.log(`Memory (MB): rss=${(mem.rss/1024/1024).toFixed(2)} heapUsed=${(mem.heapUsed/1024/1024).toFixed(2)} external=${(mem.external/1024/1024).toFixed(2)}`);
  }, 2000);

  // Stop after 60s
  setTimeout(() => {
    console.log('Stopping load test, disconnecting clients...');
    for (const s of sockets) {
      try { s.disconnect(); } catch (e) {}
    }
    clearInterval(statsInterval);
    process.exit(0);
  }, 60000);
});
