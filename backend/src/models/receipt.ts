/**
 * Transaction Receipt Model
 * Handles generation, storage, and retrieval of transaction receipts
 */

import { PrismaClient } from '@prisma/client';
import QRCode from 'qrcode';

export interface ReceiptData {
  receiptId: string;
  transactionHash: string;
  senderAddress: string;
  recipientAddress: string;
  amount: string;
  asset: string;
  tokenAddress: string;
  timestamp: Date;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  memo?: string;
  networkType: 'mainnet' | 'testnet';
}

export interface ReceiptSignature {
  algorithm: string;
  publicKey: string;
  signature: string;
  signedAt: Date;
}

export class TransactionReceipt {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Generate a unique receipt ID
   */
  generateReceiptId(): string {
    const timestamp = Date.now().toString(36);
    const randomStr = Math.random().toString(36).substring(2, 15);
    return `RCP-${timestamp}-${randomStr}`.toUpperCase();
  }

  /**
   * Create and store a new receipt
   */
  async createReceipt(receiptData: ReceiptData): Promise<any> {
    try {
      const receipt = await this.prisma.transactionReceipt.create({
        data: {
          receiptId: receiptData.receiptId,
          transactionHash: receiptData.transactionHash,
          senderAddress: receiptData.senderAddress,
          recipientAddress: receiptData.recipientAddress,
          amount: receiptData.amount,
          asset: receiptData.asset,
          tokenAddress: receiptData.tokenAddress,
          timestamp: receiptData.timestamp,
          status: receiptData.status,
          memo: receiptData.memo,
          networkType: receiptData.networkType,
          qrCode: await this.generateQRCode(receiptData.receiptId),
        },
      });

      return receipt;
    } catch (error) {
      throw new Error(`Failed to create receipt: ${error}`);
    }
  }

  /**
   * Generate QR code for receipt verification
   */
  async generateQRCode(receiptId: string): Promise<string> {
    try {
      const verificationUrl = `${process.env.RECEIPT_VERIFICATION_URL || 'https://stellarstream.io'}/verify/${receiptId}`;
      const qrCode = await QRCode.toDataURL(verificationUrl);
      return qrCode;
    } catch (error) {
      throw new Error(`Failed to generate QR code: ${error}`);
    }
  }

  /**
   * Retrieve receipt by ID
   */
  async getReceipt(receiptId: string): Promise<any> {
    try {
      const receipt = await this.prisma.transactionReceipt.findUnique({
        where: { receiptId },
      });

      if (!receipt) {
        throw new Error(`Receipt not found: ${receiptId}`);
      }

      return receipt;
    } catch (error) {
      throw new Error(`Failed to retrieve receipt: ${error}`);
    }
  }

  /**
   * Retrieve receipts for a specific address
   */
  async getReceiptsByAddress(
    address: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<any[]> {
    try {
      const receipts = await this.prisma.transactionReceipt.findMany({
        where: {
          OR: [{ senderAddress: address }, { recipientAddress: address }],
        },
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset,
      });

      return receipts;
    } catch (error) {
      throw new Error(`Failed to retrieve receipts: ${error}`);
    }
  }

  /**
   * Verify receipt authenticity
   */
  async verifyReceipt(receiptId: string, signature: ReceiptSignature): Promise<boolean> {
    try {
      const receipt = await this.getReceipt(receiptId);

      if (!receipt) {
        return false;
      }

      // Store verification attempt
      await this.prisma.receiptVerification.create({
        data: {
          receiptId,
          algorithm: signature.algorithm,
          publicKey: signature.publicKey,
          signature: signature.signature,
          verifiedAt: new Date(),
          isValid: true, // In production, implement actual signature verification
        },
      });

      return true;
    } catch (error) {
      console.error(`Receipt verification failed: ${error}`);
      return false;
    }
  }

  /**
   * Update receipt status
   */
  async updateReceiptStatus(
    receiptId: string,
    status: 'PENDING' | 'COMPLETED' | 'FAILED'
  ): Promise<any> {
    try {
      const receipt = await this.prisma.transactionReceipt.update({
        where: { receiptId },
        data: { status },
      });

      return receipt;
    } catch (error) {
      throw new Error(`Failed to update receipt status: ${error}`);
    }
  }

  /**
   * Get receipt statistics
   */
  async getReceiptStats(address: string): Promise<any> {
    try {
      const stats = await this.prisma.transactionReceipt.aggregate({
        where: {
          OR: [{ senderAddress: address }, { recipientAddress: address }],
        },
        _count: true,
      });

      const byStatus = await this.prisma.transactionReceipt.groupBy({
        by: ['status'],
        where: {
          OR: [{ senderAddress: address }, { recipientAddress: address }],
        },
        _count: true,
      });

      return {
        totalReceipts: stats._count,
        byStatus: byStatus.map((item) => ({
          status: item.status,
          count: item._count,
        })),
      };
    } catch (error) {
      throw new Error(`Failed to get receipt statistics: ${error}`);
    }
  }
}
