//! Distribution of vault-earned interest among a stream's sender, receiver, and the
//! protocol.

use crate::types::{
    InterestDistribution, INTEREST_TO_PROTOCOL, INTEREST_TO_RECEIVER, INTEREST_TO_SENDER,
};

/// Splits `total_interest` among sender, receiver, and protocol according to `strategy`.
///
/// `strategy` is a 3-bit mask: bit 0 (`INTEREST_TO_SENDER`) routes a share to the
/// sender, bit 1 (`INTEREST_TO_RECEIVER`) to the receiver, bit 2 (`INTEREST_TO_PROTOCOL`)
/// to the protocol. `3` and `7` are handled as fixed 50/50 and 33/33/33 splits; any other
/// combination of set bits splits evenly among the enabled parties, with any integer
/// remainder given to the first enabled party in sender → receiver → protocol order. An
/// unrecognized strategy with no bits set defaults to 100% receiver.
///
/// # Arguments
/// * `total_interest` - Total interest amount to distribute; non-positive values yield
///   an all-zero distribution
/// * `strategy` - Bitmask selecting which parties receive a share
///
/// # Returns
/// An [`InterestDistribution`] whose `to_sender + to_receiver + to_protocol` always
/// sums to `total_interest`.
#[allow(dead_code)]
pub fn calculate_interest_distribution(
    total_interest: i128,
    strategy: u32,
) -> InterestDistribution {
    if total_interest <= 0 {
        return InterestDistribution {
            to_sender: 0,
            to_receiver: 0,
            to_protocol: 0,
            total_interest: 0,
        };
    }

    let (to_sender, to_receiver, to_protocol) = match strategy {
        // All to sender
        INTEREST_TO_SENDER => (total_interest, 0, 0),

        // All to receiver
        INTEREST_TO_RECEIVER => (0, total_interest, 0),

        // All to protocol
        INTEREST_TO_PROTOCOL => (0, 0, total_interest),

        // 50/50 sender and receiver
        3 => {
            let half = total_interest / 2;
            let remainder = total_interest - (half * 2);
            (half + remainder, half, 0) // Give remainder to sender
        }

        // Split among all three (33/33/33)
        7 => {
            let third = total_interest / 3;
            let remainder = total_interest - (third * 3);
            (third + remainder, third, third) // Give remainder to sender
        }

        // Custom split based on bits
        _ => {
            let sender_bit = strategy & INTEREST_TO_SENDER;
            let receiver_bit = strategy & INTEREST_TO_RECEIVER;
            let protocol_bit = strategy & INTEREST_TO_PROTOCOL;

            let total_bits = (if sender_bit > 0 { 1 } else { 0 })
                + (if receiver_bit > 0 { 1 } else { 0 })
                + (if protocol_bit > 0 { 1 } else { 0 });

            if total_bits == 0 {
                // Invalid strategy, default to receiver
                (0, total_interest, 0)
            } else {
                let share = total_interest / total_bits as i128;
                let remainder = total_interest - (share * total_bits as i128);

                let to_sender = if sender_bit > 0 { share } else { 0 };
                let to_receiver = if receiver_bit > 0 { share } else { 0 };
                let to_protocol = if protocol_bit > 0 { share } else { 0 };

                // Give remainder to first enabled party
                if sender_bit > 0 {
                    (to_sender + remainder, to_receiver, to_protocol)
                } else if receiver_bit > 0 {
                    (to_sender, to_receiver + remainder, to_protocol)
                } else {
                    (to_sender, to_receiver, to_protocol + remainder)
                }
            }
        }
    };

    InterestDistribution {
        to_sender,
        to_receiver,
        to_protocol,
        total_interest,
    }
}

/// Computes interest earned by comparing a vault's current value to the original
/// deposited principal.
///
/// # Arguments
/// * `current_vault_value` - Current value of the vault position, in underlying tokens
/// * `original_principal` - Amount originally deposited into the vault
///
/// # Returns
/// `current_vault_value - original_principal`, floored at `0` (a vault value that has
/// dropped below principal is reported as zero interest, never negative).
#[allow(dead_code)]
pub fn calculate_vault_interest(current_vault_value: i128, original_principal: i128) -> i128 {
    if current_vault_value > original_principal {
        current_vault_value - original_principal
    } else {
        0 // No interest if vault value decreased
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_all_to_sender() {
        let dist = calculate_interest_distribution(1000, INTEREST_TO_SENDER);
        assert_eq!(dist.to_sender, 1000);
        assert_eq!(dist.to_receiver, 0);
        assert_eq!(dist.to_protocol, 0);
        assert_eq!(dist.total_interest, 1000);
    }

    #[test]
    fn test_all_to_receiver() {
        let dist = calculate_interest_distribution(1000, INTEREST_TO_RECEIVER);
        assert_eq!(dist.to_sender, 0);
        assert_eq!(dist.to_receiver, 1000);
        assert_eq!(dist.to_protocol, 0);
    }

    #[test]
    fn test_all_to_protocol() {
        let dist = calculate_interest_distribution(1000, INTEREST_TO_PROTOCOL);
        assert_eq!(dist.to_sender, 0);
        assert_eq!(dist.to_receiver, 0);
        assert_eq!(dist.to_protocol, 1000);
    }

    #[test]
    fn test_split_sender_receiver() {
        let dist = calculate_interest_distribution(1000, 3);
        assert_eq!(dist.to_sender, 500);
        assert_eq!(dist.to_receiver, 500);
        assert_eq!(dist.to_protocol, 0);
    }

    #[test]
    fn test_split_all_three() {
        let dist = calculate_interest_distribution(1000, 7);
        assert_eq!(dist.to_sender, 334); // Gets remainder
        assert_eq!(dist.to_receiver, 333);
        assert_eq!(dist.to_protocol, 333);
    }

    #[test]
    fn test_zero_interest() {
        let dist = calculate_interest_distribution(0, INTEREST_TO_SENDER);
        assert_eq!(dist.to_sender, 0);
        assert_eq!(dist.to_receiver, 0);
        assert_eq!(dist.to_protocol, 0);
    }

    #[test]
    fn test_vault_interest_positive() {
        let interest = calculate_vault_interest(1100, 1000);
        assert_eq!(interest, 100);
    }

    #[test]
    fn test_vault_interest_zero() {
        let interest = calculate_vault_interest(1000, 1000);
        assert_eq!(interest, 0);
    }

    #[test]
    fn test_vault_interest_negative() {
        let interest = calculate_vault_interest(900, 1000);
        assert_eq!(interest, 0); // No negative interest
    }
}
