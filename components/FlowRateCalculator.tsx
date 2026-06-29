'use client'

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import {
  convertFlowRate,
  formatFlowRate,
  parseFlowRateInput,
  calculateRelativeSize,
  getFlowRateDescription,
  type FlowRateValues,
  type TimeUnit
} from '@/lib/flowRateCalculations'
import { Plus, Trash2, Download, Upload, ChevronDown } from 'lucide-react'

export interface FlowRatePreset {
  id: string
  name: string
  values: FlowRateValues
  createdAt: Date
}

export interface FlowRateCalculatorProps {
  onValueChange?: (values: FlowRateValues) => void
  initialValues?: FlowRateValues
  onPresetSelect?: (preset: FlowRatePreset) => void
  className?: string
}

interface InputState {
  perSecond: string
  perDay: string
  perMonth: string
}

const DEFAULT_VALUES: FlowRateValues = {
  perSecond: 0,
  perDay: 0,
  perMonth: 0
}

export const FlowRateCalculator = React.memo(function FlowRateCalculator({
  onValueChange,
  initialValues = DEFAULT_VALUES,
  onPresetSelect,
  className = ''
}: FlowRateCalculatorProps) {
  // State management
  const [values, setValues] = useState<FlowRateValues>(initialValues)
  const [inputState, setInputState] = useState<InputState>({
    perSecond: initialValues.perSecond.toString(),
    perDay: initialValues.perDay.toString(),
    perMonth: initialValues.perMonth.toString()
  })
  const [presets, setPresets] = useState<FlowRatePreset[]>([])
  const [showPresetDialog, setShowPresetDialog] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [expandedPresets, setExpandedPresets] = useState(false)
  const [lastEditedUnit, setLastEditedUnit] = useState<TimeUnit | null>(null)

  const presetInputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // Load presets from localStorage on mount
  useEffect(() => {
    const savedPresets = localStorage.getItem('flowRatePresets')
    if (savedPresets) {
      try {
        const parsed = JSON.parse(savedPresets)
        setPresets(parsed)
      } catch (err) {
        console.error('Failed to load presets:', err)
      }
    }
  }, [])

  // Notify parent of value changes
  useEffect(() => {
    onValueChange?.(values)
  }, [values, onValueChange])

  // Focus preset input when dialog opens
  useEffect(() => {
    if (showPresetDialog) {
      presetInputRef.current?.focus()
    }
  }, [showPresetDialog])

  /**
   * Handle flow rate input change for a specific unit
   */
  const handleInputChange = useCallback(
    (unit: TimeUnit, rawValue: string) => {
      // Update the input state immediately for UI responsiveness
      setInputState(prev => ({
        ...prev,
        [unit]: rawValue
      }))

      // Parse and convert
      const parsed = parseFlowRateInput(rawValue)
      if (parsed !== null) {
        const conversion = convertFlowRate(parsed, unit)
        if (conversion.isValid) {
          setValues(conversion.values)
          setLastEditedUnit(unit)
        }
      }
    },
    []
  )

  /**
   * Handle input blur - clean up display format
   */
  const handleInputBlur = useCallback((unit: TimeUnit) => {
    setInputState(prev => ({
      ...prev,
      [unit]: values[unit].toString()
    }))
  }, [values])

  /**
   * Clear all values and presets
   */
  const handleReset = useCallback(() => {
    setValues(DEFAULT_VALUES)
    setInputState({
      perSecond: '0',
      perDay: '0',
      perMonth: '0'
    })
    setLastEditedUnit(null)
  }, [])

  /**
   * Save current values as a preset
   */
  const handleSavePreset = useCallback(() => {
    if (!presetName.trim()) return

    const newPreset: FlowRatePreset = {
      id: `preset_${Date.now()}`,
      name: presetName,
      values,
      createdAt: new Date()
    }

    const updated = [...presets, newPreset]
    setPresets(updated)
    localStorage.setItem('flowRatePresets', JSON.stringify(updated))

    setPresetName('')
    setShowPresetDialog(false)
  }, [presetName, values, presets])

  /**
   * Load a preset
   */
  const handleLoadPreset = useCallback(
    (preset: FlowRatePreset) => {
      setValues(preset.values)
      setInputState({
        perSecond: preset.values.perSecond.toString(),
        perDay: preset.values.perDay.toString(),
        perMonth: preset.values.perMonth.toString()
      })
      setLastEditedUnit(null)
      onPresetSelect?.(preset)
    },
    [onPresetSelect]
  )

  /**
   * Delete a preset
   */
  const handleDeletePreset = useCallback(
    (id: string) => {
      const updated = presets.filter(p => p.id !== id)
      setPresets(updated)
      localStorage.setItem('flowRatePresets', JSON.stringify(updated))
    },
    [presets]
  )

  /**
   * Export presets as JSON
   */
  const handleExportPresets = useCallback(() => {
    const data = JSON.stringify(presets, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `flow-rate-presets-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [presets])

  /**
   * Import presets from JSON
   */
  const handleImportPresets = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json'
    input.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) {
        const reader = new FileReader()
        reader.onload = (event: ProgressEvent<FileReader>) => {
          try {
            const imported = JSON.parse(event.target?.result as string)
            if (Array.isArray(imported)) {
              const updated = [...presets, ...imported]
              setPresets(updated)
              localStorage.setItem('flowRatePresets', JSON.stringify(updated))
            }
          } catch (err) {
            console.error('Failed to import presets:', err)
          }
        }
        reader.readAsText(file)
      }
    }
    input.click()
  }, [presets])

  /**
   * Handle keyboard shortcuts
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to close preset dialog
      if (e.key === 'Escape' && showPresetDialog) {
        setShowPresetDialog(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showPresetDialog])

  /**
   * Calculate relative sizes for visual bar
   */
  const maxValue = useMemo(() => {
    return Math.max(values.perSecond, values.perDay / 1000, values.perMonth / 10000, 0.001)
  }, [values])

  const relativeSize = useMemo(() => {
    return calculateRelativeSize(values.perSecond || 0.0001, 0, maxValue)
  }, [values, maxValue])

  const description = useMemo(() => {
    return getFlowRateDescription(values)
  }, [values])

  return (
    <div className={`w-full max-w-2xl mx-auto p-4 bg-white rounded-lg border border-gray-200 ${className}`}>
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-1">
          Flow Rate Calculator
        </h2>
        <p className="text-gray-600">
          Convert and manage streaming payment rates across different time units
        </p>
      </div>

      {/* Main Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {/* Per Second */}
        <div className="flex flex-col">
          <label
            htmlFor="input-per-second"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Per Second
          </label>
          <input
            id="input-per-second"
            type="number"
            inputMode="decimal"
            value={inputState.perSecond}
            onChange={e => handleInputChange('perSecond', e.target.value)}
            onBlur={() => handleInputBlur('perSecond')}
            placeholder="0.000000"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            aria-label="Flow rate per second"
            step="0.000001"
            min="0"
          />
          <p className="text-xs text-gray-500 mt-1">
            {formatFlowRate(values.perSecond, 6)} /sec
          </p>
        </div>

        {/* Per Day */}
        <div className="flex flex-col">
          <label
            htmlFor="input-per-day"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Per Day
          </label>
          <input
            id="input-per-day"
            type="number"
            inputMode="decimal"
            value={inputState.perDay}
            onChange={e => handleInputChange('perDay', e.target.value)}
            onBlur={() => handleInputBlur('perDay')}
            placeholder="0.000000"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            aria-label="Flow rate per day"
            step="0.01"
            min="0"
          />
          <p className="text-xs text-gray-500 mt-1">
            {formatFlowRate(values.perDay, 6)} /day
          </p>
        </div>

        {/* Per Month */}
        <div className="flex flex-col">
          <label
            htmlFor="input-per-month"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Per Month
          </label>
          <input
            id="input-per-month"
            type="number"
            inputMode="decimal"
            value={inputState.perMonth}
            onChange={e => handleInputChange('perMonth', e.target.value)}
            onBlur={() => handleInputBlur('perMonth')}
            placeholder="0.000000"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            aria-label="Flow rate per month"
            step="0.1"
            min="0"
          />
          <p className="text-xs text-gray-500 mt-1">
            {formatFlowRate(values.perMonth, 6)} /month
          </p>
        </div>
      </div>

      {/* Visual Bar */}
      <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-100">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-gray-700">Flow Rate Magnitude</p>
          <p className="text-sm font-semibold text-blue-600">{description}</p>
        </div>
        <div className="w-full h-8 bg-white rounded border border-blue-200 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-400 to-blue-600 transition-all duration-300 ease-out"
            style={{
              width: `${relativeSize}%`
            }}
            role="progressbar"
            aria-label="Flow rate visual representation"
            aria-valuenow={relativeSize}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Relative flow size:{' '}
          <span className="font-semibold text-gray-700">{relativeSize.toFixed(1)}%</span>
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 mb-6 flex-wrap">
        <button
          onClick={() => setShowPresetDialog(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-colors"
          aria-label="Save current flow rate as preset"
        >
          <Plus className="h-4 w-4" />
          Save as Preset
        </button>

        <button
          onClick={handleReset}
          className="inline-flex items-center gap-2 px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors"
          aria-label="Reset all values to zero"
        >
          Reset
        </button>

        <button
          onClick={handleExportPresets}
          disabled={presets.length === 0}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
          aria-label="Export presets as JSON file"
        >
          <Download className="h-4 w-4" />
          Export
        </button>

        <button
          onClick={handleImportPresets}
          className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 transition-colors"
          aria-label="Import presets from JSON file"
        >
          <Upload className="h-4 w-4" />
          Import
        </button>
      </div>

      {/* Presets Section */}
      <div className="border-t border-gray-200 pt-6">
        <button
          onClick={() => setExpandedPresets(!expandedPresets)}
          className="flex items-center justify-between w-full p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
          aria-expanded={expandedPresets}
          aria-label="Toggle presets section"
        >
          <h3 className="text-lg font-semibold text-gray-900">
            Saved Presets ({presets.length})
          </h3>
          <ChevronDown
            className={`h-5 w-5 text-gray-600 transition-transform ${
              expandedPresets ? 'rotate-180' : ''
            }`}
          />
        </button>

        {expandedPresets && (
          <div className="mt-4">
            {presets.length === 0 ? (
              <p className="text-center text-gray-500 py-4">
                No presets saved yet. Create one by clicking "Save as Preset"
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {presets.map(preset => (
                  <div
                    key={preset.id}
                    className="p-3 bg-gray-50 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">{preset.name}</p>
                        <p className="text-xs text-gray-500">
                          {getFlowRateDescription(preset.values)}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDeletePreset(preset.id)}
                        className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                        aria-label={`Delete preset "${preset.name}"`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <button
                      onClick={() => handleLoadPreset(preset)}
                      className="w-full mt-2 px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                      aria-label={`Load preset "${preset.name}"`}
                    >
                      Load
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Save Preset Dialog */}
      {showPresetDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div
            ref={dialogRef}
            className="bg-white rounded-lg shadow-lg p-6 max-w-sm w-full mx-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="preset-dialog-title"
          >
            <h3 id="preset-dialog-title" className="text-lg font-bold text-gray-900 mb-4">
              Save as Preset
            </h3>
            <input
              ref={presetInputRef}
              type="text"
              value={presetName}
              onChange={e => setPresetName(e.target.value)}
              placeholder="Enter preset name"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4"
              aria-label="Preset name"
              onKeyPress={e => {
                if (e.key === 'Enter') {
                  handleSavePreset()
                }
              }}
            />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowPresetDialog(false)
                  setPresetName('')
                }}
                className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSavePreset}
                disabled={!presetName.trim()}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
})

FlowRateCalculator.displayName = 'FlowRateCalculator'
