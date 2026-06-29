/**
 * Flow Rate Calculator - Integration Examples
 * 
 * This file demonstrates various ways to integrate and use the 
 * FlowRateCalculator component in your application.
 */

import React, { useState } from 'react'
import { FlowRateCalculator, type FlowRateValues, type FlowRatePreset } from '@/components/FlowRateCalculator'

/**
 * Example 1: Basic Usage
 * Simplest way to add the component to your page
 */
export function Example1_BasicUsage() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">Flow Rate Calculator</h1>
      <FlowRateCalculator />
    </div>
  )
}

/**
 * Example 2: With Value Tracking
 * Display the selected flow rate and use it in your application
 */
export function Example2_ValueTracking() {
  const [flowRates, setFlowRates] = useState<FlowRateValues | null>(null)

  return (
    <div className="p-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div>
          <h2 className="text-2xl font-bold mb-4">Flow Rate Calculator</h2>
          <FlowRateCalculator onValueChange={setFlowRates} />
        </div>

        <div className="p-6 bg-gray-50 rounded-lg">
          <h3 className="text-xl font-bold mb-4">Current Flow Rate</h3>

          {!flowRates ? (
            <p className="text-gray-500">Enter a flow rate to see details</p>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600">Per Second</p>
                <p className="text-2xl font-bold text-blue-600">
                  ${flowRates.perSecond.toFixed(6)}
                </p>
              </div>

              <div>
                <p className="text-sm text-gray-600">Per Day</p>
                <p className="text-2xl font-bold text-green-600">
                  ${flowRates.perDay.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </p>
              </div>

              <div>
                <p className="text-sm text-gray-600">Per Month</p>
                <p className="text-2xl font-bold text-purple-600">
                  ${flowRates.perMonth.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Example 3: With Initial Values
 * Pre-populate the calculator with starting values
 */
export function Example3_InitialValues() {
  const defaultRates: FlowRateValues = {
    perSecond: 0.5,
    perDay: 43200,
    perMonth: 1296000
  }

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold mb-4">Calculator with Default Rate</h2>
      <p className="text-gray-600 mb-4">
        This starts with a preset rate of $0.50 per second ($43,200/day)
      </p>
      <div className="max-w-2xl">
        <FlowRateCalculator initialValues={defaultRates} />
      </div>
    </div>
  )
}

/**
 * Example 4: Form Integration
 * Use as part of a larger form with validation and submission
 */
export function Example4_FormIntegration() {
  const [flowRates, setFlowRates] = useState<FlowRateValues | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!flowRates) {
      alert('Please set a flow rate')
      return
    }

    // Submit to backend or process
    console.log('Submitting flow rates:', flowRates)
    setSubmitted(true)

    // Reset after 2 seconds
    setTimeout(() => setSubmitted(false), 2000)
  }

  return (
    <div className="p-8 max-w-2xl">
      <h2 className="text-2xl font-bold mb-6">Payment Stream Setup</h2>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Payment Amount
          </label>
          <input
            type="text"
            placeholder="Recipient name"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Flow Rate
          </label>
          <FlowRateCalculator onValueChange={setFlowRates} />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Duration (Months)
          </label>
          <input
            type="number"
            min="1"
            placeholder="12"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <button
          type="submit"
          disabled={!flowRates}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitted ? '✓ Submitted!' : 'Create Payment Stream'}
        </button>
      </form>

      {flowRates && (
        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-gray-700">
            <strong>Selected Rate:</strong> ${flowRates.perMonth.toLocaleString('en-US', {
              maximumFractionDigits: 2
            })}/month
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * Example 5: With Preset Management
 * Track and react to preset selection
 */
export function Example5_PresetTracking() {
  const [selectedPreset, setSelectedPreset] = useState<FlowRatePreset | null>(null)
  const [flowRates, setFlowRates] = useState<FlowRateValues | null>(null)

  const handlePresetSelect = (preset: FlowRatePreset) => {
    setSelectedPreset(preset)
    console.log(`Loaded preset: ${preset.name}`)
  }

  return (
    <div className="p-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div>
          <h2 className="text-2xl font-bold mb-4">Flow Rate Calculator</h2>
          <FlowRateCalculator
            onValueChange={setFlowRates}
            onPresetSelect={handlePresetSelect}
          />
        </div>

        <div className="space-y-4">
          {selectedPreset ? (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <h3 className="font-bold text-green-900 mb-2">Preset Loaded</h3>
              <p className="text-green-800">
                <strong>{selectedPreset.name}</strong>
              </p>
              <p className="text-sm text-green-700 mt-2">
                {selectedPreset.values.perMonth.toLocaleString('en-US', {
                  maximumFractionDigits: 2
                })}/month
              </p>
            </div>
          ) : (
            <div className="p-4 bg-gray-100 rounded-lg text-gray-600">
              No preset loaded. Save and load a preset to see details here.
            </div>
          )}

          {flowRates && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h3 className="font-bold text-blue-900 mb-3">Current Values</h3>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-blue-700">Per Second</dt>
                  <dd className="font-mono text-blue-900">${flowRates.perSecond.toFixed(6)}</dd>
                </div>
                <div>
                  <dt className="text-blue-700">Per Day</dt>
                  <dd className="font-mono text-blue-900">
                    ${flowRates.perDay.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                  </dd>
                </div>
                <div>
                  <dt className="text-blue-700">Per Month</dt>
                  <dd className="font-mono text-blue-900">
                    ${flowRates.perMonth.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Example 6: Multiple Instances
 * Use multiple calculators for comparing rates
 */
export function Example6_MultipleInstances() {
  const [streamA, setStreamA] = useState<FlowRateValues | null>(null)
  const [streamB, setStreamB] = useState<FlowRateValues | null>(null)

  const totalMonthly =
    (streamA?.perMonth || 0) + (streamB?.perMonth || 0)
  const totalDaily = (streamA?.perDay || 0) + (streamB?.perDay || 0)

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold mb-8">Compare Payment Streams</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        <div>
          <h3 className="text-lg font-bold mb-4">Stream A</h3>
          <FlowRateCalculator onValueChange={setStreamA} />
        </div>

        <div>
          <h3 className="text-lg font-bold mb-4">Stream B</h3>
          <FlowRateCalculator onValueChange={setStreamB} />
        </div>
      </div>

      {(streamA || streamB) && (
        <div className="p-6 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border border-blue-200">
          <h3 className="text-lg font-bold mb-4">Total Combined</h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-gray-600">Per Second</p>
              <p className="text-2xl font-bold text-blue-600">
                ${((streamA?.perSecond || 0) + (streamB?.perSecond || 0)).toFixed(6)}
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-600">Per Day</p>
              <p className="text-2xl font-bold text-green-600">
                ${totalDaily.toLocaleString('en-US', { maximumFractionDigits: 2 })}
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-600">Per Month</p>
              <p className="text-2xl font-bold text-purple-600">
                ${totalMonthly.toLocaleString('en-US', { maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Example 7: Responsive Layout
 * Show different layouts for mobile and desktop
 */
export function Example7_ResponsiveLayout() {
  const [flowRates, setFlowRates] = useState<FlowRateValues | null>(null)

  return (
    <div className="p-4 md:p-8">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-8">
        <div className="lg:col-span-2">
          <h2 className="text-2xl font-bold mb-4">Set Payment Rate</h2>
          <FlowRateCalculator onValueChange={setFlowRates} />
        </div>

        <div className="lg:col-span-1">
          <div className="p-4 bg-gray-50 rounded-lg sticky top-4">
            <h3 className="font-bold mb-4">Summary</h3>

            {!flowRates ? (
              <p className="text-sm text-gray-500">
                Enter a flow rate to see the summary
              </p>
            ) : (
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-gray-600">Monthly Cost</dt>
                  <dd className="text-lg font-bold text-blue-600">
                    ${flowRates.perMonth.toLocaleString('en-US', {
                      maximumFractionDigits: 2
                    })}
                  </dd>
                </div>

                <div className="border-t pt-3">
                  <dt className="text-gray-600">Daily Cost</dt>
                  <dd className="text-lg font-bold text-green-600">
                    ${flowRates.perDay.toLocaleString('en-US', {
                      maximumFractionDigits: 2
                    })}
                  </dd>
                </div>

                <div className="border-t pt-3">
                  <dt className="text-gray-600">Continuous Rate</dt>
                  <dd className="text-lg font-bold text-purple-600">
                    ${flowRates.perSecond.toFixed(6)}/sec
                  </dd>
                </div>
              </dl>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Example 8: Advanced - Custom Styling
 */
export function Example8_CustomStyling() {
  return (
    <div className="p-8 bg-gradient-to-br from-slate-900 to-slate-800 min-h-screen">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-3xl font-bold text-white mb-2">Premium Flow Rate</h2>
        <p className="text-gray-300 mb-8">Set your payment streaming rate</p>

        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          <FlowRateCalculator className="rounded-2xl" />
        </div>
      </div>
    </div>
  )
}

/**
 * Example 9: Step in Wizard
 * Use as part of a multi-step form flow
 */
export function Example9_WizardStep() {
  const [step, setStep] = useState(1)
  const [flowRates, setFlowRates] = useState<FlowRateValues | null>(null)

  const canProceed = flowRates && flowRates.perMonth > 0

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div className={`text-center flex-1 pb-4 ${step >= 1 ? 'text-blue-600 font-bold' : 'text-gray-400'}`}>
            <div className={`w-10 h-10 rounded-full mx-auto flex items-center justify-center ${
              step >= 1 ? 'bg-blue-600 text-white' : 'bg-gray-300'
            }`}>
              1
            </div>
            <p className="text-sm mt-2">Recipients</p>
          </div>

          <div className={`flex-1 h-1 mx-2 ${step >= 2 ? 'bg-blue-600' : 'bg-gray-300'}`} />

          <div className={`text-center flex-1 pb-4 ${step >= 2 ? 'text-blue-600 font-bold' : 'text-gray-400'}`}>
            <div className={`w-10 h-10 rounded-full mx-auto flex items-center justify-center ${
              step >= 2 ? 'bg-blue-600 text-white' : 'bg-gray-300'
            }`}>
              2
            </div>
            <p className="text-sm mt-2">Flow Rate</p>
          </div>

          <div className={`flex-1 h-1 mx-2 ${step >= 3 ? 'bg-blue-600' : 'bg-gray-300'}`} />

          <div className={`text-center flex-1 pb-4 ${step >= 3 ? 'text-blue-600 font-bold' : 'text-gray-400'}`}>
            <div className={`w-10 h-10 rounded-full mx-auto flex items-center justify-center ${
              step >= 3 ? 'bg-blue-600 text-white' : 'bg-gray-300'
            }`}>
              3
            </div>
            <p className="text-sm mt-2">Review</p>
          </div>
        </div>
      </div>

      {step === 2 && (
        <div>
          <h2 className="text-2xl font-bold mb-2">Set Flow Rate</h2>
          <p className="text-gray-600 mb-6">Choose how much to stream per time period</p>

          <FlowRateCalculator onValueChange={setFlowRates} />

          <div className="flex gap-4 mt-8">
            <button
              onClick={() => setStep(1)}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={!canProceed}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step !== 2 && (
        <div className="text-center text-gray-500 py-8">
          <p>Step {step} of 3</p>
          <p className="text-sm mt-2">
            {step === 1 && 'Configure recipients first'}
            {step === 3 && 'Review your settings before submitting'}
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * Example 10: Complete Payment Setup Form
 * Full integration example with all features
 */
export function Example10_CompleteForm() {
  const [formData, setFormData] = useState({
    recipientName: '',
    recipientAddress: '',
    duration: '12'
  })
  const [flowRates, setFlowRates] = useState<FlowRateValues | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const totalPayment = (flowRates?.perMonth || 0) * parseInt(formData.duration)

    console.log('Payment Setup:', {
      ...formData,
      flowRates,
      totalPayment
    })

    setSubmitted(true)
    setTimeout(() => setSubmitted(false), 3000)
  }

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-8">Create Payment Stream</h1>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Recipient Section */}
        <div className="border-b pb-8">
          <h2 className="text-xl font-bold mb-4">Recipient Information</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Recipient Name
              </label>
              <input
                type="text"
                value={formData.recipientName}
                onChange={e => setFormData({ ...formData, recipientName: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="John Doe"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Stellar Address
              </label>
              <input
                type="text"
                value={formData.recipientAddress}
                onChange={e => setFormData({ ...formData, recipientAddress: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="GXXXXXXX..."
              />
            </div>
          </div>
        </div>

        {/* Flow Rate Section */}
        <div className="border-b pb-8">
          <h2 className="text-xl font-bold mb-4">Payment Flow Rate</h2>
          <FlowRateCalculator onValueChange={setFlowRates} />
        </div>

        {/* Duration Section */}
        <div className="border-b pb-8">
          <h2 className="text-xl font-bold mb-4">Stream Duration</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Duration (Months)
            </label>
            <input
              type="number"
              min="1"
              max="120"
              value={formData.duration}
              onChange={e => setFormData({ ...formData, duration: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Summary Section */}
        {flowRates && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <h2 className="text-xl font-bold mb-4 text-blue-900">Payment Summary</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-blue-700">Monthly Payment</p>
                <p className="text-2xl font-bold text-blue-900">
                  ${flowRates.perMonth.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </p>
              </div>

              <div>
                <p className="text-sm text-blue-700">Total for {formData.duration} months</p>
                <p className="text-2xl font-bold text-blue-900">
                  ${(flowRates.perMonth * parseInt(formData.duration)).toLocaleString('en-US', {
                    maximumFractionDigits: 2
                  })}
                </p>
              </div>

              <div>
                <p className="text-sm text-blue-700">Daily Payment</p>
                <p className="text-2xl font-bold text-blue-900">
                  ${flowRates.perDay.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </p>
              </div>

              <div>
                <p className="text-sm text-blue-700">Continuous Rate</p>
                <p className="text-2xl font-bold text-blue-900">
                  ${flowRates.perSecond.toFixed(6)}/sec
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Submit Section */}
        <div className="flex gap-4">
          <button
            type="button"
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!formData.recipientName || !formData.recipientAddress || !flowRates}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitted ? '✓ Created!' : 'Create Payment Stream'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default function ExamplesGallery() {
  const [selectedExample, setSelectedExample] = useState(1)

  const examples = [
    { id: 1, name: 'Basic Usage', component: Example1_BasicUsage },
    { id: 2, name: 'Value Tracking', component: Example2_ValueTracking },
    { id: 3, name: 'Initial Values', component: Example3_InitialValues },
    { id: 4, name: 'Form Integration', component: Example4_FormIntegration },
    { id: 5, name: 'Preset Tracking', component: Example5_PresetTracking },
    { id: 6, name: 'Multiple Instances', component: Example6_MultipleInstances },
    { id: 7, name: 'Responsive Layout', component: Example7_ResponsiveLayout },
    { id: 8, name: 'Custom Styling', component: Example8_CustomStyling },
    { id: 9, name: 'Wizard Step', component: Example9_WizardStep },
    { id: 10, name: 'Complete Form', component: Example10_CompleteForm }
  ]

  const selectedExampleObj = examples.find(ex => ex.id === selectedExample)
  const SelectedComponent = selectedExampleObj?.component || Example1_BasicUsage

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="sticky top-0 bg-white border-b shadow">
        <div className="max-w-full px-4 py-4">
          <h1 className="text-2xl font-bold mb-4">Flow Rate Calculator Examples</h1>
          <div className="flex flex-wrap gap-2">
            {examples.map(example => (
              <button
                key={example.id}
                onClick={() => setSelectedExample(example.id)}
                className={`px-3 py-1 rounded-full text-sm ${
                  selectedExample === example.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {example.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white min-h-screen">
        <SelectedComponent />
      </div>
    </div>
  )
}
