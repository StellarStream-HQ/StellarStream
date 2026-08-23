import { Server as SocketIOServer, Socket } from 'socket.io';

export interface SplitExecutedPayload {
  splitId: string;
  /** Raw sender address — anonymization is done on the frontend */
  sender: string;
  amount: string;
  token: string;
  recipientCount: number;
  timestamp: string;
}

export interface StreamEventPayload {
  streamId: string;
  sender: string;
  receiver: string;
  amount?: string;
  status?: string;
  timestamp: string;
}

export interface BalanceUpdatePayload {
  address: string;
  newBalance: string;
  timestamp: string;
}

export interface PaymentStatusPayload {
  streamId: string;
  txHash: string;
  status: 'pending' | 'confirmed' | 'failed';
  sender: string;
  receiver: string;
  amount: string;
  asset: string;
  confirmations?: number;
  errorMessage?: string;
  timestamp: string;
}

export interface StreamProgressPayload {
  streamId: string;
  sender: string;
  receiver: string;
  totalAmount: string;
  streamedAmount: string;
  percentage: number;
  remainingAmount: string;
  estimatedCompletion: string;
  timestamp: string;
}

export interface NotificationPayload {
  id: string;
  type: 'payment_received' | 'stream_created' | 'stream_completed' | 'stream_cancelled' | 'balance_change' | 'system_alert';
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'error' | 'success';
  actionUrl?: string;
  read: boolean;
  timestamp: string;
}

export interface DisputeUpdatePayload {
  id: string;
  disputeRef: string;
  status: string;
  decision: string | null;
  action: string;
  filerAddress: string;
  respondentAddress: string;
  amount: string;
  timestamp: string;
}

export class WebSocketService {
  private io: SocketIOServer;
  private userRooms: Map<string, Set<string>> = new Map();
  private socketUserMap: Map<string, string> = new Map();
  private lastPong: Map<string, number> = new Map();
  private heartbeatIntervalHandle: NodeJS.Timeout | null = null;

  constructor(io: SocketIOServer) {
    this.io = io;
    this.setupEventHandlers();
    this.startHeartbeat();
  }

  private setupEventHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      console.log(`🔌 Client connected: ${socket.id}`);

      socket.on('join-stream-room', (userAddress: string) => {
        this.joinUserRoom(socket, userAddress);
      });

      socket.on('client-pong', () => {
        this.lastPong.set(socket.id, Date.now());
      });

      socket.on('join-split-feed', () => {
        socket.join('split-feed');
      });

      socket.on('leave-stream-room', (userAddress: string) => {
        this.leaveUserRoom(socket, userAddress);
      });

      socket.on('disconnect', () => {
        console.log(`🔌 Client disconnected: ${socket.id}`);
        this.handleDisconnect(socket);
      });
    });
  }

  private joinUserRoom(socket: Socket, userAddress: string): void {
    const roomName = `stream-${userAddress}`;
    socket.join(roomName);
    this.socketUserMap.set(socket.id, userAddress);
    this.lastPong.set(socket.id, Date.now());

    if (!this.userRooms.has(userAddress)) {
      this.userRooms.set(userAddress, new Set());
    }
    this.userRooms.get(userAddress)!.add(socket.id);

    console.log(`📱 Socket ${socket.id} joined room for user: ${userAddress}`);
    socket.emit('joined-room', { userAddress, roomName });
  }

  private leaveUserRoom(socket: Socket, userAddress: string): void {
    const roomName = `stream-${userAddress}`;
    socket.leave(roomName);

    const userSockets = this.userRooms.get(userAddress);
    if (userSockets) {
      userSockets.delete(socket.id);
      if (userSockets.size === 0) {
        this.userRooms.delete(userAddress);
      }
    }
    this.socketUserMap.delete(socket.id);
    this.lastPong.delete(socket.id);

    console.log(`📱 Socket ${socket.id} left room for user: ${userAddress}`);
    socket.emit('left-room', { userAddress, roomName });
  }

  private handleDisconnect(socket: Socket): void {
    for (const [userAddress, sockets] of this.userRooms.entries()) {
      if (sockets.has(socket.id)) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          this.userRooms.delete(userAddress);
        }
        break;
      }
    }
    this.socketUserMap.delete(socket.id);
    this.lastPong.delete(socket.id);
  }

  stopHeartbeat(): void {
    if (this.heartbeatIntervalHandle) {
      clearInterval(this.heartbeatIntervalHandle);
      this.heartbeatIntervalHandle = null;
    }
  }

  emitNewStream(userAddress: string, payload: StreamEventPayload): void {
    const roomName = `stream-${userAddress}`;
    this.io.to(roomName).emit('new-stream', payload);
    console.log(`🚀 Emitted NEW_STREAM to room ${roomName}:`, payload);
  }

  emitBalanceUpdate(userAddress: string, payload: BalanceUpdatePayload): void {
    const roomName = `stream-${userAddress}`;
    this.io.to(roomName).emit('balance-update', payload);
    console.log(`💰 Emitted BALANCE_UPDATE to room ${roomName}:`, payload);
  }

  emitTransactionStatus(userAddress: string, payload: { txId: string; status: string; timestamp: string; details?: any }): void {
    const roomName = `stream-${userAddress}`;
    this.io.to(roomName).emit('transaction-status', payload);
    console.log(`🔁 Emitted TRANSACTION_STATUS to ${roomName}:`, payload);
  }

  getConnectedUsers(): string[] {
    return Array.from(this.userRooms.keys());
  }

  getUserSocketCount(userAddress: string): number {
    return this.userRooms.get(userAddress)?.size || 0;
  }

  broadcastToAll(event: string, payload: any): void {
    this.io.emit(event, payload);
    console.log(`📢 Broadcasted ${event} to all clients:`, payload);
  }

  emitSplitExecuted(payload: SplitExecutedPayload): void {
    this.io.to('split-feed').emit('SPLIT_EXECUTED', payload);
    console.log(`✂️  Emitted SPLIT_EXECUTED to split-feed:`, payload);
  }

  /**
   * Emit payment status update to a user's room
   */
  emitPaymentStatus(userAddress: string, payload: PaymentStatusPayload): void {
    const roomName = `stream-${userAddress}`;
    this.io.to(roomName).emit('payment-status', payload);
    console.log(`💳 Emitted PAYMENT_STATUS to ${roomName}:`, payload);
  }

  /**
   * Emit stream progress update to a user's room
   */
  emitStreamProgress(userAddress: string, payload: StreamProgressPayload): void {
    const roomName = `stream-${userAddress}`;
    this.io.to(roomName).emit('stream-progress', payload);
    console.log(`📊 Emitted STREAM_PROGRESS to ${roomName}:`, payload);
  }

  /**
   * Emit notification to a user's room
   */
  emitNotification(userAddress: string, payload: NotificationPayload): void {
    const roomName = `stream-${userAddress}`;
    this.io.to(roomName).emit('notification', payload);
    console.log(`🔔 Emitted NOTIFICATION to ${roomName}:`, payload);
  }

  /**
   * Broadcast active user count to all connected clients
   */
  broadcastActiveUserCount(): void {
    const count = this.userRooms.size;
    this.io.emit('active-users', { count, timestamp: new Date().toISOString() });
  }

  /**
   * Emit a dispute update to both the filer and respondent rooms
   */
  emitDisputeUpdate(payload: DisputeUpdatePayload): void {
    const filerRoom = `stream-${payload.filerAddress}`;
    const respondentRoom = `stream-${payload.respondentAddress}`;
    this.io.to(filerRoom).emit('dispute-update', payload);
    this.io.to(respondentRoom).emit('dispute-update', payload);
    console.log(`⚖️  Emitted DISPUTE_UPDATE to ${filerRoom} and ${respondentRoom}:`, payload);
  }

  /**
   * Update the heartbeat to also broadcast active user count periodically
   */
  startHeartbeat(intervalMs = 15000, staleMs = 45000): void {
    if (this.heartbeatIntervalHandle) return;
    this.heartbeatIntervalHandle = setInterval(() => {
      const now = Date.now();
      for (const [id, socket] of this.io.sockets.sockets) {
        try {
          socket.emit('server-ping', { ts: now });
        } catch (err) {
          console.warn('Failed to send heartbeat to', id, err);
        }
      }

      // Broadcast active user count every heartbeat cycle
      this.broadcastActiveUserCount();

      // Disconnect stale sockets that didn't respond
      for (const [socketId, last] of this.lastPong.entries()) {
        if (now - last > staleMs) {
          const s = this.io.sockets.sockets.get(socketId);
          if (s) {
            console.log(`⏱️  Disconnecting stale socket ${socketId}`);
            s.disconnect(true);
          }
          this.lastPong.delete(socketId);
          const userAddr = this.socketUserMap.get(socketId);
          if (userAddr) {
            const set = this.userRooms.get(userAddr);
            if (set) {
              set.delete(socketId);
              if (set.size === 0) this.userRooms.delete(userAddr);
            }
            this.socketUserMap.delete(socketId);
          }
        }
      }
    }, intervalMs);
  }
}

export type WebSocketServiceType = WebSocketService;
