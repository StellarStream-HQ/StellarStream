'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface SettingsFormData {
  email: string;
  name: string;
  organization: string;
}

interface SettingsFormProps {
  initialData?: SettingsFormData;
  onSubmit?: (data: SettingsFormData) => Promise<void>;
}

/**
 * Settings Form Component
 *
 * User profile and account settings form.
 * Handles updates to personal information.
 */
export default function SettingsForm({
  initialData = {
    email: '',
    name: '',
    organization: '',
  },
  onSubmit,
}: SettingsFormProps) {
  const [formData, setFormData] = useState<SettingsFormData>(initialData);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onSubmit) return;

    setError('');
    setIsLoading(true);

    try {
      await onSubmit(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update settings');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="glass-card p-8">
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="glass-card p-4 bg-red-500/10 border-red-500/30">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium">Full Name</label>
            <Input
              type="text"
              name="name"
              placeholder="Your name"
              value={formData.name}
              onChange={handleChange}
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium">Email</label>
            <Input
              type="email"
              name="email"
              placeholder="your@email.com"
              value={formData.email}
              onChange={handleChange}
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium">Organization</label>
            <Input
              type="text"
              name="organization"
              placeholder="Your organization"
              value={formData.organization}
              onChange={handleChange}
            />
          </div>
        </div>

        <div className="flex gap-4 justify-end pt-6 border-t border-white/10">
          <Button variant="outline" className="border-white/20">
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isLoading}
            className="bg-cyan-500 hover:bg-cyan-600 text-black font-semibold"
          >
            {isLoading ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
