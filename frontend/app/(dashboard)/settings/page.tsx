'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

/**
 * Settings Page
 *
 * User profile, account, security, and preference settings.
 * Organized into logical tabs/sections.
 */
export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'profile' | 'security' | 'billing'>('profile');
  const [formData, setFormData] = useState({
    email: '',
    name: '',
    organization: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSave = () => {
    // TODO: Implement save logic
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="space-y-2">
        <h1 className="font-heading text-4xl font-bold">Settings</h1>
        <p className="text-white/60">
          Manage your account and preferences
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-white/10 overflow-x-auto">
        {(['profile', 'security', 'billing'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-3 font-medium text-sm transition border-b-2 capitalize ${
              activeTab === tab
                ? 'border-cyan-500 text-cyan-400'
                : 'border-transparent text-white/60 hover:text-white/80'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Profile Tab */}
      {activeTab === 'profile' && (
        <Card className="glass-card p-8 max-w-2xl">
          <div className="space-y-6">
            <h2 className="font-heading text-xl font-bold">Profile Information</h2>

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
                <label className="block text-sm font-medium">Email Address</label>
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

            <div className="pt-6 border-t border-white/10 flex justify-end gap-4">
              <Button variant="outline" className="border-white/20">
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                className="bg-cyan-500 hover:bg-cyan-600 text-black font-semibold"
              >
                Save Changes
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Security Tab */}
      {activeTab === 'security' && (
        <div className="space-y-6">
          {/* Change Password */}
          <Card className="glass-card p-8 max-w-2xl">
            <div className="space-y-6">
              <h2 className="font-heading text-xl font-bold">Change Password</h2>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="block text-sm font-medium">Current Password</label>
                  <Input
                    type="password"
                    placeholder="••••••••"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium">New Password</label>
                  <Input
                    type="password"
                    placeholder="••••••••"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium">Confirm Password</label>
                  <Input
                    type="password"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <div className="pt-6 border-t border-white/10 flex justify-end gap-4">
                <Button variant="outline" className="border-white/20">
                  Cancel
                </Button>
                <Button className="bg-cyan-500 hover:bg-cyan-600 text-black font-semibold">
                  Update Password
                </Button>
              </div>
            </div>
          </Card>

          {/* Two-Factor Authentication */}
          <Card className="glass-card p-8 max-w-2xl">
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-heading text-lg font-bold">
                    Two-Factor Authentication
                  </h3>
                  <p className="text-sm text-white/60 mt-1">
                    Add an extra layer of security to your account
                  </p>
                </div>
                <Button className="bg-cyan-500 hover:bg-cyan-600 text-black font-semibold">
                  Enable 2FA
                </Button>
              </div>
            </div>
          </Card>

          {/* Connected Devices */}
          <Card className="glass-card p-8 max-w-2xl">
            <div className="space-y-4">
              <h3 className="font-heading text-lg font-bold">Active Sessions</h3>
              <p className="text-sm text-white/70">
                No active sessions. Manage your connected devices here.
              </p>
            </div>
          </Card>
        </div>
      )}

      {/* Billing Tab */}
      {activeTab === 'billing' && (
        <Card className="glass-card p-8 max-w-2xl">
          <div className="space-y-6">
            <h2 className="font-heading text-xl font-bold">Billing</h2>

            <div className="space-y-4">
              <div className="flex justify-between py-3 border-b border-white/10">
                <span className="text-white/60">Plan</span>
                <span className="font-medium">Free</span>
              </div>

              <div className="flex justify-between py-3 border-b border-white/10">
                <span className="text-white/60">Status</span>
                <span className="text-green-400 font-medium">Active</span>
              </div>

              <div className="flex justify-between py-3">
                <span className="text-white/60">Next Billing</span>
                <span>N/A</span>
              </div>
            </div>

            <div className="pt-6 border-t border-white/10">
              <Button variant="outline" className="border-white/20">
                View Billing History
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
