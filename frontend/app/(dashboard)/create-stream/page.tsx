'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

/**
 * Create Stream Page
 *
 * Multi-step wizard for creating new streams.
 * Guides users through recipient selection, amount, duration, and confirmation.
 */
export default function CreateStreamPage() {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    recipient: '',
    amount: '',
    asset: 'USDC',
    duration: 'monthly',
    startDate: '',
    description: '',
  });

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleNext = () => {
    if (step < 4) setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Submit stream creation
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Page Header */}
      <div className="space-y-2">
        <h1 className="font-heading text-4xl font-bold">Create Stream</h1>
        <p className="text-white/60">
          Set up a new continuous payment stream
        </p>
      </div>

      {/* Progress Indicator */}
      <div className="flex items-center justify-between">
        {[1, 2, 3, 4].map((num) => (
          <div key={num} className="flex items-center">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold transition ${
                step >= num
                  ? 'bg-cyan-500 text-black'
                  : 'bg-white/10 text-white/60'
              }`}
            >
              {num}
            </div>
            {num < 4 && (
              <div
                className={`flex-1 h-1 mx-4 transition ${
                  step > num ? 'bg-cyan-500' : 'bg-white/10'
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Form Container */}
      <Card className="glass-card p-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Step 1: Recipient */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="font-heading text-2xl font-bold mb-4">
                  Who receives the stream?
                </h2>
                <div className="space-y-2">
                  <label className="block text-sm font-medium">
                    Recipient Address
                  </label>
                  <Input
                    type="text"
                    name="recipient"
                    placeholder="GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                    value={formData.recipient}
                    onChange={handleChange}
                  />
                  <p className="text-xs text-white/50">
                    Enter the Stellar address of the recipient
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Amount & Asset */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="font-heading text-2xl font-bold mb-4">
                  Stream amount and asset
                </h2>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium">
                      Amount
                    </label>
                    <Input
                      type="number"
                      name="amount"
                      placeholder="0.00"
                      value={formData.amount}
                      onChange={handleChange}
                      step="0.01"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium">
                      Asset
                    </label>
                    <select
                      name="asset"
                      value={formData.asset}
                      onChange={handleChange}
                      className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white"
                    >
                      <option value="USDC">USDC</option>
                      <option value="XLM">XLM</option>
                      <option value="USDT">USDT</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Duration */}
          {step === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="font-heading text-2xl font-bold mb-4">
                  Stream duration
                </h2>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium">
                      Duration Type
                    </label>
                    <select
                      name="duration"
                      value={formData.duration}
                      onChange={handleChange}
                      className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white"
                    >
                      <option value="one-time">One-time</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium">
                      Start Date
                    </label>
                    <Input
                      type="date"
                      name="startDate"
                      value={formData.startDate}
                      onChange={handleChange}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Review */}
          {step === 4 && (
            <div className="space-y-6">
              <div>
                <h2 className="font-heading text-2xl font-bold mb-6">
                  Review your stream
                </h2>
                <div className="space-y-4">
                  <div className="flex justify-between py-3 border-b border-white/10">
                    <span className="text-white/60">Recipient</span>
                    <span className="font-ticker text-sm text-right truncate">
                      {formData.recipient || '--'}
                    </span>
                  </div>
                  <div className="flex justify-between py-3 border-b border-white/10">
                    <span className="text-white/60">Amount</span>
                    <span className="font-semibold">
                      {formData.amount} {formData.asset}
                    </span>
                  </div>
                  <div className="flex justify-between py-3 border-b border-white/10">
                    <span className="text-white/60">Duration</span>
                    <span className="capitalize">{formData.duration}</span>
                  </div>
                  <div className="flex justify-between py-3">
                    <span className="text-white/60">Start Date</span>
                    <span>{formData.startDate || '--'}</span>
                  </div>
                </div>
              </div>
              <div className="glass-card p-4 border-cyan-500/30 bg-cyan-500/5">
                <p className="text-sm text-white/70">
                  By creating this stream, you acknowledge that you have reviewed
                  all details and are ready to execute the transaction.
                </p>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between pt-6 border-t border-white/10">
            <Button
              type="button"
              onClick={handleBack}
              disabled={step === 1}
              variant="outline"
              className="border-white/20 hover:bg-white/5 disabled:opacity-50"
            >
              Back
            </Button>
            {step < 4 ? (
              <Button
                type="button"
                onClick={handleNext}
                className="bg-cyan-500 hover:bg-cyan-600 text-black font-semibold"
              >
                Next
              </Button>
            ) : (
              <Button
                type="submit"
                className="bg-cyan-500 hover:bg-cyan-600 text-black font-semibold"
              >
                Create Stream
              </Button>
            )}
          </div>
        </form>
      </Card>
    </div>
  );
}
