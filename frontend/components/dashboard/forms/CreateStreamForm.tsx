'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface CreateStreamFormProps {
  onSubmit?: (data: CreateStreamFormData) => Promise<void>;
}

export interface CreateStreamFormData {
  recipient: string;
  amount: string;
  asset: string;
  duration: string;
  startDate: string;
}

/**
 * Create Stream Form Component
 *
 * Multi-step form for creating new streams.
 * Collects all required information and handles validation.
 */
export default function CreateStreamForm({
  onSubmit,
}: CreateStreamFormProps) {
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState<CreateStreamFormData>({
    recipient: '',
    amount: '',
    asset: 'USDC',
    duration: 'monthly',
    startDate: '',
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onSubmit) return;

    setIsLoading(true);
    try {
      await onSubmit(formData);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="glass-card p-8">
      <form onSubmit={handleSubmit} className="space-y-6">
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <h2 className="font-heading text-2xl font-bold mb-4">
                Recipient Address
              </h2>
              <div className="space-y-2">
                <label className="block text-sm font-medium">Address</label>
                <Input
                  type="text"
                  name="recipient"
                  placeholder="GXXXXXXXXX..."
                  value={formData.recipient}
                  onChange={handleChange}
                  required
                />
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h2 className="font-heading text-2xl font-bold mb-4">
                Amount & Asset
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="block text-sm font-medium">Amount</label>
                  <Input
                    type="number"
                    name="amount"
                    placeholder="0.00"
                    value={formData.amount}
                    onChange={handleChange}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium">Asset</label>
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

        <div className="flex gap-4 justify-between pt-6 border-t border-white/10">
          <Button
            type="button"
            onClick={() => setStep(Math.max(1, step - 1))}
            disabled={step === 1}
            variant="outline"
            className="border-white/20"
          >
            Back
          </Button>
          {step < 2 ? (
            <Button
              type="button"
              onClick={() => setStep(step + 1)}
              className="bg-cyan-500 hover:bg-cyan-600 text-black font-semibold"
            >
              Next
            </Button>
          ) : (
            <Button
              type="submit"
              disabled={isLoading}
              className="bg-cyan-500 hover:bg-cyan-600 text-black font-semibold"
            >
              {isLoading ? 'Creating...' : 'Create Stream'}
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}
