/**
 * Flow Rate Calculation Utilities
 * Provides accurate conversions between different time units with 6 decimal precision
 */

// Constants for time conversions
const SECONDS_PER_DAY = 86400
const SECONDS_PER_MONTH = 2592000 // 30 days
const DAYS_PER_MONTH = 30

export type TimeUnit = 'perSecond' | 'perDay' | 'perMonth'

export interface FlowRateValues {
  perSecond: number
  perDay: number
  perMonth: number
}

export interface ConversionResult {
  values: FlowRateValues
  isValid: boolean
  error?: string
}

/**
 * Rounds a number to 6 decimal places
 */
export const roundTo6Decimals = (value: number): number => {
  return Math.round(value * 1000000) / 1000000
}

/**
 * Validates if a number is safe for calculations
 */
export const isValidNumber = (value: number): boolean => {
  return Number.isFinite(value) && value >= 0
}

/**
 * Converts from one time unit to all other units
 * @param value - The flow rate value
 * @param fromUnit - The unit of the input value
 * @returns Object containing converted values for all units or error info
 */
export const convertFlowRate = (value: number, fromUnit: TimeUnit): ConversionResult => {
  // Validate input
  if (!isValidNumber(value)) {
    return {
      values: { perSecond: 0, perDay: 0, perMonth: 0 },
      isValid: false,
      error: 'Invalid number provided'
    }
  }

  let perSecond: number

  // Convert to perSecond as the base unit
  switch (fromUnit) {
    case 'perSecond':
      perSecond = value
      break
    case 'perDay':
      perSecond = value / SECONDS_PER_DAY
      break
    case 'perMonth':
      perSecond = value / SECONDS_PER_MONTH
      break
    default:
      return {
        values: { perSecond: 0, perDay: 0, perMonth: 0 },
        isValid: false,
        error: 'Unknown time unit'
      }
  }

  // Calculate other units from perSecond
  const perDay = perSecond * SECONDS_PER_DAY
  const perMonth = perSecond * SECONDS_PER_MONTH

  // Round to 6 decimal places
  const result: FlowRateValues = {
    perSecond: roundTo6Decimals(perSecond),
    perDay: roundTo6Decimals(perDay),
    perMonth: roundTo6Decimals(perMonth)
  }

  return {
    values: result,
    isValid: true
  }
}

/**
 * Formats a number for display with proper decimal places
 * @param value - The number to format
 * @param decimals - Number of decimal places to show (default 6)
 */
export const formatFlowRate = (value: number, decimals: number = 6): string => {
  if (!isValidNumber(value)) return '0'
  
  // Use exponential notation for very small numbers
  if (value > 0 && value < 0.000001) {
    return value.toExponential(6)
  }
  
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
    useGrouping: true
  })
}

/**
 * Parses a string input to a number, handling various formats
 * @param input - The string to parse
 * @returns Parsed number or null if invalid
 */
export const parseFlowRateInput = (input: string): number | null => {
  if (!input || input.trim() === '') return null
  
  const trimmed = input.trim()
  
  // Handle exponential notation
  if (trimmed.includes('e') || trimmed.includes('E')) {
    const parsed = parseFloat(trimmed)
    return isValidNumber(parsed) ? parsed : null
  }
  
  // Handle standard decimal notation
  const parsed = parseFloat(trimmed)
  return isValidNumber(parsed) ? parsed : null
}

/**
 * Calculates the relative size as a percentage (0-100) for visual representation
 * @param value - The flow rate value
 * @param minValue - The minimum value in comparison set
 * @param maxValue - The maximum value in comparison set
 * @returns Percentage from 0-100
 */
export const calculateRelativeSize = (
  value: number,
  minValue: number,
  maxValue: number
): number => {
  if (!isValidNumber(value) || !isValidNumber(minValue) || !isValidNumber(maxValue)) {
    return 0
  }

  if (minValue === maxValue) return 50 // Default to middle if all values are the same

  const range = maxValue - minValue
  if (range === 0) return 50

  const relative = ((value - minValue) / range) * 100
  return Math.max(0, Math.min(100, relative)) // Clamp to 0-100
}

/**
 * Generates a human-readable description of a flow rate
 */
export const getFlowRateDescription = (values: FlowRateValues): string => {
  const { perMonth, perDay, perSecond } = values

  if (perMonth >= 1) {
    return `$${formatFlowRate(perMonth, 2)}/month`
  } else if (perDay >= 1) {
    return `$${formatFlowRate(perDay, 2)}/day`
  } else if (perSecond >= 0.01) {
    return `$${formatFlowRate(perSecond, 4)}/sec`
  } else {
    return `$${formatFlowRate(perSecond, 6)}/sec`
  }
}
