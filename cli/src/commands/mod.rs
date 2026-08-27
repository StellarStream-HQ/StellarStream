//! Command implementations.

pub mod admin;
pub mod config_cmd;
pub mod stream;

use soroban_client::xdr::{Int128Parts, ScVal, ScVec};

use crate::error::{CliError, Result};

/// Decode a `u64` returned by the contract.
pub fn sc_to_u64(value: &ScVal) -> Result<u64> {
    match value {
        ScVal::U64(n) => Ok(*n),
        ScVal::U32(n) => Ok(*n as u64),
        other => Err(CliError::Contract(format!(
            "expected a u64, got {other:?}"
        ))),
    }
}

/// Decode a `u32` returned by the contract.
pub fn sc_to_u32(value: &ScVal) -> Result<u32> {
    match value {
        ScVal::U32(n) => Ok(*n),
        other => Err(CliError::Contract(format!(
            "expected a u32, got {other:?}"
        ))),
    }
}

/// Decode an `i128` returned by the contract.
pub fn sc_to_i128(value: &ScVal) -> Result<i128> {
    match value {
        ScVal::I128(Int128Parts { hi, lo }) => {
            Ok(((*hi as i128) << 64) | (*lo as i128 & 0xFFFF_FFFF_FFFF_FFFF))
        }
        ScVal::U32(n) => Ok(*n as i128),
        ScVal::I32(n) => Ok(*n as i128),
        other => Err(CliError::Contract(format!(
            "expected an i128, got {other:?}"
        ))),
    }
}

/// Decode a `Vec<u64>` returned by the contract.
pub fn sc_to_u64_vec(value: &ScVal) -> Result<Vec<u64>> {
    match value {
        ScVal::Vec(Some(ScVec(items))) => items.iter().map(sc_to_u64).collect(),
        ScVal::Void => Ok(Vec::new()),
        other => Err(CliError::Contract(format!(
            "expected a list of stream ids, got {other:?}"
        ))),
    }
}

/// Build an `i128` `ScVal` for an argument.
pub fn i128_arg(value: i128) -> ScVal {
    ScVal::I128(Int128Parts {
        hi: (value >> 64) as i64,
        lo: (value & 0xFFFF_FFFF_FFFF_FFFF) as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_integers() {
        assert_eq!(sc_to_u64(&ScVal::U64(42)).unwrap(), 42);
        assert_eq!(sc_to_u32(&ScVal::U32(7)).unwrap(), 7);
    }

    #[test]
    fn i128_survives_a_round_trip() {
        for value in [0i128, 1, 1_000_000, i64::MAX as i128 + 1, i128::MAX] {
            assert_eq!(sc_to_i128(&i128_arg(value)).unwrap(), value, "value {value}");
        }
    }

    #[test]
    fn decodes_a_list_of_stream_ids() {
        let list = ScVal::Vec(Some(ScVec(
            vec![ScVal::U64(1), ScVal::U64(2), ScVal::U64(3)]
                .try_into()
                .unwrap(),
        )));
        assert_eq!(sc_to_u64_vec(&list).unwrap(), vec![1, 2, 3]);
    }

    #[test]
    fn an_absent_list_decodes_as_empty() {
        assert!(sc_to_u64_vec(&ScVal::Void).unwrap().is_empty());
    }

    #[test]
    fn a_wrong_type_is_reported_rather_than_guessed() {
        assert!(sc_to_u64(&ScVal::Bool(true)).is_err());
        assert!(sc_to_i128(&ScVal::Bool(true)).is_err());
    }
}
