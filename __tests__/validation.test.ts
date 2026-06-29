import {
  validateStellarAddress,
  validateAmount,
  validateAsset,
  validateMemo,
  validateRecipient,
  formatAmount
} from '../lib/validation'
import { ASSET_CONFIGS } from '../lib/utils'

const VALID_G_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
const VALID_M_ADDRESS = 'MAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACTA4'

describe('Validation Utilities', () => {
  describe('validateStellarAddress', () => {
    it('should validate a checksum-valid G Stellar address', () => {
      const result = validateStellarAddress(VALID_G_ADDRESS)
      expect(result.isValid).toBe(true)
      expect(result.errorMessage).toBeUndefined()
    })

    it('should validate a checksum-valid M Stellar address', () => {
      const result = validateStellarAddress(VALID_M_ADDRESS)
      expect(result.isValid).toBe(true)
      expect(result.errorMessage).toBeUndefined()
    })

    it('should reject a truncated M Stellar address', () => {
      const result = validateStellarAddress(VALID_M_ADDRESS.slice(0, 56))
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('Invalid Stellar address format')
    })

    it('should reject empty address', () => {
      const result = validateStellarAddress('')
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('Address is required')
    })

    it('should reject address with wrong format', () => {
      const result = validateStellarAddress('invalid_address')
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('Invalid Stellar address format')
    })

    it('should reject address with unsupported prefix', () => {
      const result = validateStellarAddress(`C${VALID_G_ADDRESS.slice(1)}`)
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('Invalid Stellar address format')
    })

    it('should reject address that is too short', () => {
      const result = validateStellarAddress('GABC')
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('Invalid Stellar address format')
    })

    it('should reject address with invalid base32 characters', () => {
      const result = validateStellarAddress(`G${'0'.repeat(55)}`)
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('Invalid Stellar address format')
    })

    it('should reject address with invalid checksum', () => {
      const result = validateStellarAddress(`${VALID_G_ADDRESS.slice(0, -1)}G`)
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('Invalid Stellar address format')
    })
  })

  describe('validateAmount', () => {
    it('should validate a positive number', () => {
      const result = validateAmount('10.50', 'USDC')
      expect(result.isValid).toBe(true)
    })

    it('should validate zero amount', () => {
      const result = validateAmount('0', 'USDC')
      expect(result.isValid).toBe(true)
    })

    it('should reject negative amount', () => {
      const result = validateAmount('-5', 'USDC')
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('Amount must be a positive number')
    })

    it('should reject non-numeric amount', () => {
      const result = validateAmount('abc', 'USDC')
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('Amount must be a positive number')
    })

    it('should respect minimum amount for USDC', () => {
      const result = validateAmount('0.001', 'USDC')
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('Minimum amount for USDC is 0.01')
    })

    it('should respect decimal places for USDC', () => {
      const result = validateAmount('10.123', 'USDC')
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('Maximum 2 decimal places allowed for USDC')
    })

    it('should respect decimal places for XLM', () => {
      const result = validateAmount('1.12345678', 'XLM')
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('Maximum 7 decimal places allowed for XLM')
    })
  })

  describe('validateAsset', () => {
    it('should validate a correct asset code', () => {
      const result = validateAsset('USDC')
      expect(result.isValid).toBe(true)
    })

    it('should validate single character asset', () => {
      const result = validateAsset('X')
      expect(result.isValid).toBe(true)
    })

    it('should reject empty asset', () => {
      const result = validateAsset('')
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('Asset code is required')
    })

    it('should reject asset that is too long', () => {
      const result = validateAsset('VERYLONGASSET')
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('Asset code must be 1-12 alphanumeric characters')
    })

    it('should reject asset with special characters', () => {
      const result = validateAsset('USDC-TEST')
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('Asset code must be 1-12 alphanumeric characters')
    })
  })

  describe('validateMemo', () => {
    it('should validate empty memo', () => {
      const result = validateMemo('')
      expect(result.isValid).toBe(true)
    })

    it('should validate short memo', () => {
      const result = validateMemo('Payment')
      expect(result.isValid).toBe(true)
    })

    it('should reject memo that is too long', () => {
      const result = validateMemo('This memo is way too long and exceeds the limit')
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('Memo must be 28 characters or less')
    })
  })

  describe('validateRecipient', () => {
    it('should validate a complete valid recipient', () => {
      const recipient = {
        address: VALID_G_ADDRESS,
        amount: 10.50,
        asset: 'USDC',
        memo: 'Payment'
      }
      const result = validateRecipient(recipient)
      expect(result.isValid).toBe(true)
    })

    it('should validate a complete recipient with a muxed Stellar address', () => {
      const recipient = {
        address: VALID_M_ADDRESS,
        amount: 10.50,
        asset: 'USDC',
        memo: 'Payment'
      }
      const result = validateRecipient(recipient)
      expect(result.isValid).toBe(true)
    })

    it('should reject recipient with invalid address', () => {
      const recipient = {
        address: 'invalid',
        amount: 10.50,
        asset: 'USDC',
        memo: 'Payment'
      }
      const result = validateRecipient(recipient)
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('Invalid Stellar address format')
    })

    it('should reject recipient with invalid amount', () => {
      const recipient = {
        address: VALID_G_ADDRESS,
        amount: -5,
        asset: 'USDC',
        memo: 'Payment'
      }
      const result = validateRecipient(recipient)
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBe('Amount must be a positive number')
    })
  })

  describe('formatAmount', () => {
    it('should format USDC with 2 decimal places', () => {
      const result = formatAmount(10.5, 'USDC')
      expect(result).toBe('10.50')
    })

    it('should format XLM with 7 decimal places', () => {
      const result = formatAmount(1.1234567, 'XLM')
      expect(result).toBe('1.1234567')
    })

    it('should handle unknown asset', () => {
      const result = formatAmount(10.12345, 'UNKNOWN')
      expect(result).toBe('10.12345')
    })
  })
})

describe('Asset Configurations', () => {
  it('should have correct USDC configuration', () => {
    const usdcConfig = ASSET_CONFIGS.USDC
    expect(usdcConfig.code).toBe('USDC')
    expect(usdcConfig.requiresDecimals).toBe(true)
    expect(usdcConfig.maxDecimals).toBe(2)
    expect(usdcConfig.minAmount).toBe(0.01)
  })

  it('should have correct XLM configuration', () => {
    const xlmConfig = ASSET_CONFIGS.XLM
    expect(xlmConfig.code).toBe('XLM')
    expect(xlmConfig.requiresDecimals).toBe(true)
    expect(xlmConfig.maxDecimals).toBe(7)
    expect(xlmConfig.minAmount).toBe(0.0000001)
  })
})
