const STELLAR_ACCOUNT_ADDRESS_LENGTH = 56;
const STELLAR_MUXED_ADDRESS_LENGTH = 69;
const STELLAR_ACCOUNT_ID_VERSION_BYTE = 6 << 3;
const STELLAR_MUXED_ACCOUNT_VERSION_BYTE = 12 << 3;
const STELLAR_ACCOUNT_DECODED_LENGTH = 35;
const STELLAR_MUXED_DECODED_LENGTH = 43;

function base32Value(char: string): number {
  const code = char.charCodeAt(0);

  if (code >= 65 && code <= 90) {
    return code - 65;
  }

  if (code >= 50 && code <= 55) {
    return code - 24;
  }

  return -1;
}

function decodeStellarAddress(address: string, decodedLength: number): Uint8Array | null {
  const decoded = new Uint8Array(decodedLength);
  let bitBuffer = 0;
  let bitCount = 0;
  let decodedIndex = 0;

  for (let i = 0; i < address.length; i++) {
    const value = base32Value(address[i]);
    if (value < 0) {
      return null;
    }

    bitBuffer = (bitBuffer << 5) | value;
    bitCount += 5;

    if (bitCount >= 8) {
      bitCount -= 8;
      if (decodedIndex >= decoded.length) {
        return null;
      }

      decoded[decodedIndex] = (bitBuffer >> bitCount) & 0xff;
      decodedIndex += 1;
      bitBuffer &= (1 << bitCount) - 1;
    }
  }

  if (decodedIndex !== decodedLength || bitBuffer !== 0) {
    return null;
  }

  return decoded;
}

function crc16XModem(bytes: Uint8Array): number {
  let crc = 0;

  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 8;

    for (let bit = 0; bit < 8; bit++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }

  return crc;
}

function hasValidStellarChecksum(decoded: Uint8Array): boolean {
  const payload = decoded.slice(0, decoded.length - 2);
  const expectedChecksum = decoded[decoded.length - 2] | (decoded[decoded.length - 1] << 8);

  return crc16XModem(payload) === expectedChecksum;
}

export function isValidStellarRecipientAddress(address: string): boolean {
  const trimmedAddress = address.trim();
  const version = trimmedAddress[0];
  const expectedLength = version === "G"
    ? STELLAR_ACCOUNT_ADDRESS_LENGTH
    : version === "M"
      ? STELLAR_MUXED_ADDRESS_LENGTH
      : null;
  const expectedDecodedLength = version === "G"
    ? STELLAR_ACCOUNT_DECODED_LENGTH
    : version === "M"
      ? STELLAR_MUXED_DECODED_LENGTH
      : null;
  const expectedVersionByte = version === "G"
    ? STELLAR_ACCOUNT_ID_VERSION_BYTE
    : version === "M"
      ? STELLAR_MUXED_ACCOUNT_VERSION_BYTE
      : null;

  if (!expectedLength || !expectedDecodedLength || !expectedVersionByte || trimmedAddress.length !== expectedLength) {
    return false;
  }

  const decoded = decodeStellarAddress(trimmedAddress, expectedDecodedLength);
  return decoded !== null && decoded[0] === expectedVersionByte && hasValidStellarChecksum(decoded);
}
