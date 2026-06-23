import { io, Socket } from 'socket.io-client';

const SERVER_URL = 'http://localhost:3000';
const TEST_USER_ADDRESS = 'GDTESTUSER123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

console.log('🧪 Testing WebSocket connection...');

const socket: Socket = io(SERVER_URL);

socket.on('connect', () => {
  console.log(`✅ Connected to WebSocket server with ID: ${socket.id}`);
  
  console.log('📱 Joining stream room for test user...');
  socket.emit('join-stream-room', TEST_USER_ADDRESS);
});

socket.on('joined-room', (data) => {
  console.log('✅ Successfully joined room:', data);
});

socket.on('new-stream', (payload) => {
  console.log('🚀 Received NEW_STREAM event:', payload);
});

socket.on('balance-update', (payload) => {
  console.log('💰 Received BALANCE_UPDATE event:', payload);
});

// Respond to server heartbeat
socket.on('server-ping', (data) => {
  console.log('🏓 Received server-ping, sending client-pong');
  socket.emit('client-pong');
});

socket.on('disconnect', () => {
  console.log('❌ Disconnected from WebSocket server');
});

socket.on('connect_error', (error) => {
  console.error('❌ Connection error:', error.message);
});

setTimeout(() => {
  console.log('🧪 Test completed. Closing connection...');
  socket.disconnect();
}, 10000);
