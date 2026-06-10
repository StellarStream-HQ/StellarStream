/**
 * useAuth - Authentication state management hook
 * Manages user authentication status and related operations
 */

import { useWallet } from '@/lib/wallet-context';

export interface AuthUser {
  address: string;
  isConnected: boolean;
  network: 'testnet' | 'mainnet';
}

export function useAuth() {
  const context = useWallet();

  const isAuthenticated = !!context.address;

  return {
    address: context.address,
    isConnected: context.isConnected,
    isAuthenticated,
    network: context.network as 'testnet' | 'mainnet',
    connect: context.connectFreighter,
    disconnect: context.disconnect,
  };
}
