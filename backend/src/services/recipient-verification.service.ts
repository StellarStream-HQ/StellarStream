import { PayoutStatus } from "../generated/client/index.js";
import { prisma } from "../lib/db.js";
import { logger } from "../logger.js";

export interface RecipientPaymentInfo {
  disbursementId: string;
  recipientAddress: string;
  amount: string;
  status: string;
  asset: string;
  senderAddress: string;
  createdAt: Date;
}

export class RecipientVerificationService {
  async getMyPayments(address: string): Promise<RecipientPaymentInfo[]> {
    try {
      const recipients = await prisma.splitRecipient.findMany({
        where: {
          recipientAddress: address,
          status: {
            in: [PayoutStatus.PENDING, PayoutStatus.SENT],
          },
        },
        include: {
          disbursement: {
            select: {
              id: true,
              senderAddress: true,
              asset: true,
              createdAt: true,
            },
          },
        },
        orderBy: {
          disbursement: {
            createdAt: "desc",
          },
        },
      });

      return recipients.map((recipient: any) => ({
        disbursementId: recipient.disbursementId,
        recipientAddress: recipient.recipientAddress,
        amount: recipient.amount,
        status: recipient.status,
        asset: recipient.disbursement.asset,
        senderAddress: recipient.disbursement.senderAddress,
        createdAt: recipient.disbursement.createdAt,
      }));
    } catch (error) {
      logger.error("[RecipientVerificationService] Failed to fetch recipient payments", error, {
        address,
      });
      throw error;
    }
  }
}
