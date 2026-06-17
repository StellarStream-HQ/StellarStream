// lib/hooks/use-transaction-feed.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

/**
 * Transaction feed item interface
 * Represents a single event in the transaction feed
 */
export interface TransactionFeedItem {
  id: string;
  type: string; // union of known types + string for extensibility
  description: string;
  timestamp: string;
  actor?: string;
  asset?: string;
  amount?: string;
  status?: string;
}

/**
 * Return type for useTransactionFeed hook
 * Includes reconnection state and feed management
 */
export interface UseTransactionFeedReturn {
  feed: TransactionFeedItem[];
  loading: boolean;
  error: string | null;
  reconnecting: boolean;
  reconnectAttempt: number;
  connectionLost: boolean;
}

// Exponential back-off delays in milliseconds: 1s, 2s, 4s, 8s, 16s
const BACKOFF_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];

/**
 * Hook to manage transaction feed with WebSocket connection
 * Includes exponential back-off reconnection and feed state management
 */
export const useTransactionFeed = (): UseTransactionFeedReturn => {
  const [feed, setFeed] = useState<TransactionFeedItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState<boolean>(false);
  const [reconnectAttempt, setReconnectAttempt] = useState<number>(0);
  const [connectionLost, setConnectionLost] = useState<boolean>(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const attemptReconnectRef = useRef<(attempt?: number) => void>();

  /**
   * Attempt to reconnect with exponential back-off.
   * Uses ref to avoid stale closure + infinite loop issues.
   */
  const attemptReconnect = useCallback<(...args: [number?]) => void>((attempt = 0) => {
    if (attempt >= BACKOFF_DELAYS_MS.length) {
      setReconnecting(false);
      setConnectionLost(true);
      return;
    }

    const delay = BACKOFF_DELAYS_MS[attempt];
    setReconnectAttempt(attempt + 1);
    setReconnecting(true);

    reconnectTimeoutRef.current = setTimeout(() => {
      // Reconnect via the socket stored in ref
      if (socketRef.current) {
        socketRef.current.connect();
      }
    }, delay);
  }, []);

  // Keep ref in sync so the callback never goes stale
  attemptReconnectRef.current = attemptReconnect;

  // Refs for stable socket reference
  const socketRef = useRef<Socket | null>(null);

  // Initialize socket connection (runs once)
  useEffect(() => {
    const initSocket = async () => {
      try {
        const socketIO = io(process.env.NEXT_PUBLIC_API_URL!, {
          transports: ['websocket'],
          reconnection: false,
          timeout: 10000,
        });

        socketRef.current = socketIO;
        setSocket(socketIO);

        socketIO.on('connect', () => {
          console.log('Connected to WebSocket server');
          setLoading(false);
          setError(null);
          setReconnecting(false);
          setReconnectAttempt(0);
          setConnectionLost(false);
        });

        socketIO.on('connect_error', (err) => {
          console.error('WebSocket connection error:', err);
          setError('Failed to connect to transaction feed');
          setLoading(false);
        });

        socketIO.on('disconnect', (reason) => {
          console.log('Disconnected from WebSocket server:', reason);
          attemptReconnectRef.current?.(0);
        });

        socketIO.on('transaction-event', (data: TransactionFeedItem) => {
          setFeed((prev) => {
            const updated = [data, ...prev].slice(0, 50);
            return updated;
          });
        });

        socketIO.on('ledger-confirmation', (data: TransactionFeedItem) => {
          setFeed((prev) => {
            const index = prev.findIndex((item) => item.id === data.id);
            if (index !== -1) {
              const updated = [...prev];
              updated[index] = { ...updated[index], ...data };
              return updated;
            }
            const newFeed = [data, ...prev].slice(0, 50);
            return newFeed;
          });
        });

        return () => {
          socketIO.disconnect();
          socketRef.current = null;
        };
      } catch (err) {
        console.error('Failed to initialize WebSocket:', err);
        setError('Failed to initialize transaction feed');
        setLoading(false);
      }
    };

    initSocket();
  }, []); // ✅ Runs only once — no more infinite loop

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (socket) {
        socket.disconnect();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [socket]);

  return {
    feed,
    loading,
    error,
    reconnecting,
    reconnectAttempt,
    connectionLost,
  };
};