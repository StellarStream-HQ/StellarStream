/**
 * Flow Rate Calculator Tests
 * Tests for conversion accuracy, edge cases, and calculations
 */

import {
  convertFlowRate,
  formatFlowRate,
  parseFlowRateInput,
  calculateRelativeSize,
  getFlowRateDescription,
  roundTo6Decimals,
  isValidNumber,
  type FlowRateValues,
  type TimeUnit
} from '@/lib/flowRateCalculations'

describe('Flow Rate Calculations', () => {
  describe('roundTo6Decimals', () => {
    it('should round to exactly 6 decimal places', () => {
      expect(roundTo6Decimals(0.1234567)).toBe(0.123457)
      expect(roundTo6Decimals(0.999999)).toBe(0.999999)
      expect(roundTo6Decimals(1.0000001)).toBe(1.0)
    })

    it('should handle very small numbers', () => {
      expect(roundTo6Decimals(0.000001)).toBe(0.000001)
      expect(roundTo6Decimals(0.0000001)).toBe(0.0)
    })

    it('should handle zero', () => {
      expect(roundTo6Decimals(0)).toBe(0)
    })

    it('should handle large numbers', () => {
      expect(roundTo6Decimals(1000000.123456789)).toBe(1000000.123457)
    })
  })

  describe('isValidNumber', () => {
    it('should accept positive numbers', () => {
      expect(isValidNumber(0)).toBe(true)
      expect(isValidNumber(1)).toBe(true)
      expect(isValidNumber(0.000001)).toBe(true)
      expect(isValidNumber(1000000)).toBe(true)
    })

    it('should reject invalid numbers', () => {
      expect(isValidNumber(NaN)).toBe(false)
      expect(isValidNumber(Infinity)).toBe(false)
      expect(isValidNumber(-1)).toBe(false)
      expect(isValidNumber(-0.1)).toBe(false)
    })
  })

  describe('convertFlowRate', () => {
    describe('Per Second conversions', () => {
      it('should convert 1 per second correctly', () => {
        const result = convertFlowRate(1, 'perSecond')
        expect(result.isValid).toBe(true)
        expect(result.values.perSecond).toBe(1)
        expect(result.values.perDay).toBe(86400)
        expect(result.values.perMonth).toBe(2592000)
      })

      it('should convert 0.5 per second correctly', () => {
        const result = convertFlowRate(0.5, 'perSecond')
        expect(result.isValid).toBe(true)
        expect(result.values.perSecond).toBe(0.5)
        expect(result.values.perDay).toBe(43200)
        expect(result.values.perMonth).toBe(1296000)
      })

      it('should maintain 6 decimal precision for small numbers', () => {
        const result = convertFlowRate(0.000001, 'perSecond')
        expect(result.isValid).toBe(true)
        expect(result.values.perSecond).toBe(0.000001)
        // Check that decimals are maintained
        expect(result.values.perDay.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(6)
      })
    })

    describe('Per Day conversions', () => {
      it('should convert 86400 per day to 1 per second', () => {
        const result = convertFlowRate(86400, 'perDay')
        expect(result.isValid).toBe(true)
        expect(result.values.perSecond).toBe(1)
        expect(result.values.perDay).toBe(86400)
        expect(result.values.perMonth).toBe(2592000)
      })

      it('should convert 1 per day correctly', () => {
        const result = convertFlowRate(1, 'perDay')
        expect(result.isValid).toBe(true)
        expect(result.values.perDay).toBe(1)
        const perSecond = roundTo6Decimals(1 / 86400)
        expect(result.values.perSecond).toBe(perSecond)
      })
    })

    describe('Per Month conversions', () => {
      it('should convert 2592000 per month to 1 per second', () => {
        const result = convertFlowRate(2592000, 'perMonth')
        expect(result.isValid).toBe(true)
        expect(result.values.perSecond).toBe(1)
      })

      it('should convert 1 per month correctly', () => {
        const result = convertFlowRate(1, 'perMonth')
        expect(result.isValid).toBe(true)
        expect(result.values.perMonth).toBe(1)
        const perSecond = roundTo6Decimals(1 / 2592000)
        expect(result.values.perSecond).toBe(perSecond)
      })
    })

    describe('Edge cases', () => {
      it('should handle zero', () => {
        const result = convertFlowRate(0, 'perSecond')
        expect(result.isValid).toBe(true)
        expect(result.values.perSecond).toBe(0)
        expect(result.values.perDay).toBe(0)
        expect(result.values.perMonth).toBe(0)
      })

      it('should reject NaN', () => {
        const result = convertFlowRate(NaN, 'perSecond')
        expect(result.isValid).toBe(false)
        expect(result.error).toBeDefined()
      })

      it('should reject negative numbers', () => {
        const result = convertFlowRate(-1, 'perSecond')
        expect(result.isValid).toBe(false)
      })

      it('should reject Infinity', () => {
        const result = convertFlowRate(Infinity, 'perSecond')
        expect(result.isValid).toBe(false)
      })

      it('should handle very large numbers', () => {
        const result = convertFlowRate(1000000, 'perSecond')
        expect(result.isValid).toBe(true)
        expect(result.values.perSecond).toBe(1000000)
        expect(result.values.perDay).toBe(86400000000)
      })

      it('should handle very small numbers (6 decimal precision)', () => {
        const result = convertFlowRate(0.000001, 'perSecond')
        expect(result.isValid).toBe(true)
        expect(result.values.perSecond).toBe(0.000001)
      })

      it('should handle unknown time unit gracefully', () => {
        const result = convertFlowRate(1, 'invalidUnit' as TimeUnit)
        expect(result.isValid).toBe(false)
        expect(result.error).toBeDefined()
      })
    })

    describe('Decimal precision (6 places)', () => {
      it('should maintain 6 decimal places in all conversions', () => {
        const result = convertFlowRate(0.123456, 'perSecond')
        expect(result.isValid).toBe(true)
        // Check that values are rounded to 6 decimals
        expect(result.values.perSecond.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(6)
        expect(result.values.perDay.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(6)
        expect(result.values.perMonth.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(6)
      })

      it('should not have floating point errors', () => {
        // This tests the classic floating point issue: 0.1 + 0.2 !== 0.3
        const result1 = convertFlowRate(1, 'perSecond')
        const result2 = convertFlowRate(1, 'perDay')
        const result3 = convertFlowRate(1, 'perMonth')

        // All should be valid and have 6 decimal precision
        expect(result1.isValid).toBe(true)
        expect(result2.isValid).toBe(true)
        expect(result3.isValid).toBe(true)
      })
    })
  })

  describe('formatFlowRate', () => {
    it('should format positive numbers correctly', () => {
      expect(formatFlowRate(1)).toBe('1')
      expect(formatFlowRate(1000)).toBe('1,000')
      expect(formatFlowRate(1000000)).toBe('1,000,000')
    })

    it('should format decimals correctly', () => {
      const formatted = formatFlowRate(1.123456)
      expect(formatted).toContain('1')
    })

    it('should use exponential notation for very small numbers', () => {
      const formatted = formatFlowRate(0.0000001)
      expect(formatted).toContain('e')
    })

    it('should handle zero', () => {
      expect(formatFlowRate(0)).toBe('0')
    })

    it('should respect custom decimal places', () => {
      const formatted = formatFlowRate(1.123456, 2)
      expect(formatted).toContain('1')
    })

    it('should handle invalid input', () => {
      expect(formatFlowRate(NaN)).toBe('0')
      expect(formatFlowRate(Infinity)).toBe('0')
      expect(formatFlowRate(-1)).toBe('0')
    })
  })

  describe('parseFlowRateInput', () => {
    it('should parse valid decimal strings', () => {
      expect(parseFlowRateInput('1')).toBe(1)
      expect(parseFlowRateInput('1.5')).toBe(1.5)
      expect(parseFlowRateInput('0.000001')).toBe(0.000001)
    })

    it('should handle whitespace', () => {
      expect(parseFlowRateInput('  1  ')).toBe(1)
      expect(parseFlowRateInput('  1.5  ')).toBe(1.5)
    })

    it('should parse exponential notation', () => {
      expect(parseFlowRateInput('1e-6')).toBe(0.000001)
      expect(parseFlowRateInput('1E-6')).toBe(0.000001)
    })

    it('should reject invalid input', () => {
      expect(parseFlowRateInput('')).toBeNull()
      expect(parseFlowRateInput('  ')).toBeNull()
      expect(parseFlowRateInput('abc')).toBeNull()
      expect(parseFlowRateInput('1.2.3')).toBeNull()
    })

    it('should reject negative numbers', () => {
      expect(parseFlowRateInput('-1')).toBeNull()
    })
  })

  describe('calculateRelativeSize', () => {
    it('should return 0-100 range', () => {
      const size = calculateRelativeSize(5, 0, 10)
      expect(size).toBe(50)
    })

    it('should return 0 for minimum value', () => {
      const size = calculateRelativeSize(0, 0, 10)
      expect(size).toBe(0)
    })

    it('should return 100 for maximum value', () => {
      const size = calculateRelativeSize(10, 0, 10)
      expect(size).toBe(100)
    })

    it('should handle equal min and max', () => {
      const size = calculateRelativeSize(5, 5, 5)
      expect(size).toBe(50) // Default to middle
    })

    it('should clamp values to 0-100', () => {
      expect(calculateRelativeSize(-5, 0, 10)).toBe(0)
      expect(calculateRelativeSize(15, 0, 10)).toBe(100)
    })

    it('should handle invalid inputs', () => {
      expect(calculateRelativeSize(NaN, 0, 10)).toBe(0)
      expect(calculateRelativeSize(5, NaN, 10)).toBe(0)
      expect(calculateRelativeSize(5, 0, NaN)).toBe(0)
    })
  })

  describe('getFlowRateDescription', () => {
    it('should show monthly for large values', () => {
      const values: FlowRateValues = {
        perSecond: 1,
        perDay: 86400,
        perMonth: 2592000
      }
      const desc = getFlowRateDescription(values)
      expect(desc).toContain('/month')
    })

    it('should show daily for mid-range values', () => {
      const values: FlowRateValues = {
        perSecond: 0.0001,
        perDay: 8.64,
        perMonth: 259.2
      }
      const desc = getFlowRateDescription(values)
      expect(desc).toContain('/day')
    })

    it('should show per second for small values', () => {
      const values: FlowRateValues = {
        perSecond: 0.001,
        perDay: 0.0864,
        perMonth: 2.592
      }
      const desc = getFlowRateDescription(values)
      expect(desc).toContain('/sec')
    })

    it('should always include dollar sign', () => {
      const values: FlowRateValues = {
        perSecond: 0.5,
        perDay: 43200,
        perMonth: 1296000
      }
      const desc = getFlowRateDescription(values)
      expect(desc).toContain('$')
    })
  })

  describe('Round-trip conversions', () => {
    it('should maintain values through round-trip conversions', () => {
      const original = 1.234567
      const result1 = convertFlowRate(original, 'perSecond')
      const result2 = convertFlowRate(result1.values.perDay, 'perDay')

      expect(result1.values.perSecond).toBe(roundTo6Decimals(original))
      expect(result2.values.perSecond).toBe(result1.values.perSecond)
    })

    it('should handle multiple round trips', () => {
      let values: FlowRateValues = { perSecond: 0.5, perDay: 43200, perMonth: 1296000 }

      const result1 = convertFlowRate(values.perSecond, 'perSecond')
      const result2 = convertFlowRate(result1.values.perDay, 'perDay')
      const result3 = convertFlowRate(result2.values.perMonth, 'perMonth')

      expect(result3.values.perSecond).toBe(result1.values.perSecond)
    })
  })

  describe('Real-world scenarios', () => {
    it('should calculate $1000/month streaming rate', () => {
      const result = convertFlowRate(1000, 'perMonth')
      expect(result.isValid).toBe(true)
      expect(result.values.perMonth).toBe(1000)
      // 1000 / 30 days / 86400 seconds = 0.0003858 per second
      expect(result.values.perSecond).toBeCloseTo(0.000386, 5)
    })

    it('should calculate $100/day streaming rate', () => {
      const result = convertFlowRate(100, 'perDay')
      expect(result.isValid).toBe(true)
      expect(result.values.perDay).toBe(100)
      // 100 / 86400 = 0.0011574 per second
      expect(result.values.perSecond).toBeCloseTo(0.001157, 5)
    })

    it('should calculate $0.01/second streaming rate', () => {
      const result = convertFlowRate(0.01, 'perSecond')
      expect(result.isValid).toBe(true)
      expect(result.values.perSecond).toBe(0.01)
      expect(result.values.perDay).toBe(864)
      expect(result.values.perMonth).toBe(25920)
    })
  })
})
