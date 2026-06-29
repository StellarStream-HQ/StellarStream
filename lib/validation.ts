import { ValidationResult, AssetConfig, ASSET_CONFIGS } from './utils'

const STELLAR_ACCOUNT_ADDRESS_LENGTH = 56
const STELLAR_MUXED_ADDRESS_LENGTH = 69
const STELLAR_ACCOUNT_ID_VERSION_BYTE = 6 << 3
const STELLAR_MUXED_ACCOUNT_VERSION_BYTE = 12 << 3
const STELLAR_ACCOUNT_DECODED_LENGTH = 35
const STELLAR_MUXED_DECODED_LENGTH = 43

function base32Value(char: string): number {
  const code = char.charCodeAt(0)

  if (code >= 65 && code <= 90) {
    return code - 65
  }

  if (code >= 50 && code <= 55) {
    return code - 24
  }

  return -1
}

function decodeStellarAddress(address: string, decodedLength: number): Uint8Array | null {
  const decoded = new Uint8Array(decodedLength)
  let bitBuffer = 0
  let bitCount = 0
  let decodedIndex = 0

  for (let i = 0; i < address.length; i++) {
    const value = base32Value(address[i])
    if (value < 0) {
      return null
    }

    bitBuffer = (bitBuffer << 5) | value
    bitCount += 5

    if (bitCount >= 8) {
      bitCount -= 8
      if (decodedIndex >= decoded.length) {
        return null
      }

      decoded[decodedIndex] = (bitBuffer >> bitCount) & 0xff
      decodedIndex += 1
      bitBuffer &= (1 << bitCount) - 1
    }
  }

  if (decodedIndex !== decodedLength || bitBuffer !== 0) {
    return null
  }

  return decoded
}

function crc16XModem(bytes: Uint8Array): number {
  let crc = 0

  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 8

    for (let bit = 0; bit < 8; bit++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff
      } else {
        crc = (crc << 1) & 0xffff
      }
    }
  }

  return crc
}

function hasValidStellarChecksum(decoded: Uint8Array): boolean {
  const payload = decoded.slice(0, decoded.length - 2)
  const expectedChecksum = decoded[decoded.length - 2] | (decoded[decoded.length - 1] << 8)

  return crc16XModem(payload) === expectedChecksum
}

/**
 * Validates a Stellar address format
 * @param address - The Stellar address to validate
 * @returns ValidationResult indicating if the address is valid
 */
export function validateStellarAddress(address: string): ValidationResult {
  if (!address || address.trim().length === 0) {
    return {
      isValid: false,
      errorMessage: 'Address is required'
    }
  }

  const trimmedAddress = address.trim()
  const version = trimmedAddress[0]
  const expectedLength = version === 'G'
    ? STELLAR_ACCOUNT_ADDRESS_LENGTH
    : version === 'M'
      ? STELLAR_MUXED_ADDRESS_LENGTH
      : null
  const expectedDecodedLength = version === 'G'
    ? STELLAR_ACCOUNT_DECODED_LENGTH
    : version === 'M'
      ? STELLAR_MUXED_DECODED_LENGTH
      : null
  const expectedVersionByte = version === 'G'
    ? STELLAR_ACCOUNT_ID_VERSION_BYTE
    : version === 'M'
      ? STELLAR_MUXED_ACCOUNT_VERSION_BYTE
      : null

  if (!expectedLength || !expectedDecodedLength || !expectedVersionByte || trimmedAddress.length !== expectedLength) {
    return {
      isValid: false,
      errorMessage: 'Invalid Stellar address format'
    }
  }

  const decoded = decodeStellarAddress(trimmedAddress, expectedDecodedLength)
  if (!decoded) {
    return {
      isValid: false,
      errorMessage: 'Invalid Stellar address format'
    }
  }

  if (decoded[0] !== expectedVersionByte) {
    return {
      isValid: false,
      errorMessage: 'Invalid Stellar address format'
    }
  }

  if (!hasValidStellarChecksum(decoded)) {
    return {
      isValid: false,
      errorMessage: 'Invalid Stellar address format'
    }
  }

  return { isValid: true }
}

/**
 * Validates payment amount based on asset configuration
 * @param amount - The amount to validate
 * @param asset - The asset code
 * @returns ValidationResult indicating if the amount is valid
 */
export function validateAmount(amount: string | number, asset: string): ValidationResult {
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount

  if (isNaN(numAmount) || numAmount < 0) {
    return {
      isValid: false,
      errorMessage: 'Amount must be a positive number'
    }
  }

  const assetConfig = ASSET_CONFIGS[asset.toUpperCase()]
  if (assetConfig && assetConfig.minAmount && numAmount < assetConfig.minAmount) {
    return {
      isValid: false,
      errorMessage: `Minimum amount for ${asset} is ${assetConfig.minAmount}`
    }
  }

  if (assetConfig && assetConfig.maxDecimals) {
    const decimalPlaces = (numAmount.toString().split('.')[1] || '').length
    if (decimalPlaces > assetConfig.maxDecimals) {
      return {
        isValid: false,
        errorMessage: `Maximum ${assetConfig.maxDecimals} decimal places allowed for ${asset}`
      }
    }
  }

  return { isValid: true }
}

/**
 * Validates asset code format
 * @param asset - The asset code to validate
 * @returns ValidationResult indicating if the asset code is valid
 */
export function validateAsset(asset: string): ValidationResult {
  if (!asset || asset.trim().length === 0) {
    return {
      isValid: false,
      errorMessage: 'Asset code is required'
    }
  }

  const trimmedAsset = asset.trim().toUpperCase()
  
  // Asset codes must be 1-12 alphanumeric characters
  const assetRegex = /^[A-Z0-9]{1,12}$/
  if (!assetRegex.test(trimmedAsset)) {
    return {
      isValid: false,
      errorMessage: 'Asset code must be 1-12 alphanumeric characters'
    }
  }

  return { isValid: true }
}

/**
 * Validates memo text
 * @param memo - The memo text to validate
 * @returns ValidationResult indicating if the memo is valid
 */
export function validateMemo(memo: string): ValidationResult {
  // Memo is optional, but if provided should not exceed reasonable limits
  if (memo && memo.length > 28) {
    return {
      isValid: false,
      errorMessage: 'Memo must be 28 characters or less'
    }
  }

  return { isValid: true }
}

/**
 * Validates recipient data comprehensively
 * @param recipient - The recipient to validate
 * @returns ValidationResult indicating if the recipient is valid
 */
export function validateRecipient(recipient: {
  address: string
  amount: number
  asset: string
  memo: string
}): ValidationResult {
  const addressValidation = validateStellarAddress(recipient.address)
  if (!addressValidation.isValid) {
    return addressValidation
  }

  const amountValidation = validateAmount(recipient.amount, recipient.asset)
  if (!amountValidation.isValid) {
    return amountValidation
  }

  const assetValidation = validateAsset(recipient.asset)
  if (!assetValidation.isValid) {
    return assetValidation
  }

  const memoValidation = validateMemo(recipient.memo)
  if (!memoValidation.isValid) {
    return memoValidation
  }

  return { isValid: true }
}

/**
 * Formats amount for display based on asset configuration
 * @param amount - The amount to format
 * @param asset - The asset code
 * @returns Formatted amount string
 */
export function formatAmount(amount: number, asset: string): string {
  const assetConfig = ASSET_CONFIGS[asset.toUpperCase()]
  
  if (!assetConfig || !assetConfig.maxDecimals) {
    return amount.toString()
  }

  return amount.toFixed(assetConfig.maxDecimals)
}

/**
 * Sanitizes input by trimming whitespace
 * @param input - The input to sanitize
 * @returns Sanitized string
 */
export function sanitizeInput(input: string): string {
  return input.trim()
}
