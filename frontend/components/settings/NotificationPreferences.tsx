'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Bell, Mail, Shield, BarChart3, RefreshCw, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NotificationPreferences {
    email: string | null;
    emailVerified: boolean;
    paymentConfirmations: boolean;
    streamStatusUpdates: boolean;
    securityAlerts: boolean;
    weeklySummaries: boolean;
}

interface ToggleSwitchProps {
    enabled: boolean;
    onChange: (v: boolean) => void;
    disabled?: boolean;
}

// ─── Toggle Switch ────────────────────────────────────────────────────────────

function ToggleSwitch({ enabled, onChange, disabled = false }: ToggleSwitchProps) {
    return (
        <button
            type="button"
            onClick={() => !disabled && onChange(!enabled)}
            disabled={disabled}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${enabled
                    ? 'border-cyan-500/50 bg-cyan-500/20'
                    : 'border-white/10 bg-white/5'
                } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
            role="switch"
            aria-checked={enabled}
        >
            <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition duration-200 ease-in-out ${enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
            />
        </button>
    );
}

// ─── Preference Row ───────────────────────────────────────────────────────────

interface PreferenceRowProps {
    icon: React.ReactNode;
    label: string;
    description: string;
    enabled: boolean;
    onChange: (v: boolean) => void;
}

function PreferenceRow({ icon, label, description, enabled, onChange }: PreferenceRowProps) {
    return (
        <div
            className={`flex items-center gap-4 rounded-xl p-4 transition-all duration-200 ${enabled
                    ? 'bg-white/[0.03] border border-white/[0.06]'
                    : 'border border-transparent'
                }`}
        >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-white/40">
                {icon}
            </div>
            <div className="min-w-0 flex-1">
                <p
                    className={`font-heading text-sm font-semibold transition-colors ${enabled ? 'text-white/85' : 'text-white/35'
                        }`}
                >
                    {label}
                </p>
                <p className="font-mono text-[10px] text-white/25 leading-relaxed">
                    {description}
                </p>
            </div>
            <ToggleSwitch enabled={enabled} onChange={onChange} />
        </div>
    );
}

// ─── Delivery History Card ────────────────────────────────────────────────────

interface Delivery {
    id: string;
    template: string;
    subject: string;
    status: string;
    errorMessage: string | null;
    sentAt: string;
    deliveredAt: string | null;
    openedAt: string | null;
}

function DeliveryHistoryCard() {
    const [deliveries, setDeliveries] = useState<Delivery[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // For demo purposes, show empty state with a "Refresh" button
    // In production, this would fetch from the API

    const handleRefresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            // In production, this would be: const res = await fetch('/api/v1/notifications/email/deliveries/{address}')
            // For now, show empty state
            setDeliveries([]);
        } catch (err) {
            setError('Failed to load delivery history');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        handleRefresh();
    }, [handleRefresh]);

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'SENT':
                return <RefreshCw className="h-3.5 w-3.5 text-cyan-400" />;
            case 'DELIVERED':
                return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />;
            case 'OPENED':
                return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />;
            case 'BOUNCED':
            case 'FAILED':
                return <XCircle className="h-3.5 w-3.5 text-red-400" />;
            default:
                return <Loader2 className="h-3.5 w-3.5 text-white/30" />;
        }
    };

    const getStatusBadge = (status: string) => {
        const variants: Record<string, 'info' | 'success' | 'warning' | 'error'> = {
            SENT: 'info',
            DELIVERED: 'success',
            OPENED: 'success',
            BOUNCED: 'warning',
            FAILED: 'error',
        };
        return (
            <Badge variant={variants[status] || 'neutral'} size="sm" dot>
                {status}
            </Badge>
        );
    };

    const templateLabels: Record<string, string> = {
        payment_confirmation: 'Payment Confirmation',
        stream_status: 'Stream Status',
        security_alert: 'Security Alert',
        weekly_summary: 'Weekly Summary',
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="font-heading text-lg font-bold text-white">Email Delivery History</h3>
                    <p className="font-mono text-xs text-white/40">Recent email delivery status</p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefresh}
                    isLoading={loading}
                    icon={<RefreshCw className="h-3.5 w-3.5" />}
                    className="border-white/10"
                >
                    Refresh
                </Button>
            </div>

            {error && (
                <Alert variant="error" title="Error" closable onClose={() => setError(null)}>
                    {error}
                </Alert>
            )}

            {deliveries.length === 0 && !loading && (
                <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center">
                    <Mail className="mx-auto mb-3 h-8 w-8 text-white/20" />
                    <p className="font-heading text-sm font-semibold text-white/50">No email deliveries yet</p>
                    <p className="font-mono text-xs text-white/30 mt-1">
                        When emails are sent, they will appear here with delivery status.
                    </p>
                </div>
            )}

            {loading && (
                <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
                    <span className="ml-2 font-mono text-xs text-white/40">Loading delivery history...</span>
                </div>
            )}

            {deliveries.length > 0 && (
                <div className="space-y-2">
                    {deliveries.map((delivery) => (
                        <div
                            key={delivery.id}
                            className="flex items-center gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"
                        >
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5">
                                {getStatusIcon(delivery.status)}
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="font-heading text-sm font-semibold text-white/80 truncate">
                                    {delivery.subject}
                                </p>
                                <div className="flex items-center gap-2 mt-1">
                                    <span className="font-mono text-[10px] text-white/30">
                                        {templateLabels[delivery.template] || delivery.template}
                                    </span>
                                    <span className="text-white/10">·</span>
                                    <span className="font-mono text-[10px] text-white/30">
                                        {new Date(delivery.sentAt).toLocaleDateString()}
                                    </span>
                                </div>
                            </div>
                            {getStatusBadge(delivery.status)}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function NotificationPreferences() {
    const [preferences, setPreferences] = useState<NotificationPreferences>({
        email: null,
        emailVerified: false,
        paymentConfirmations: true,
        streamStatusUpdates: true,
        securityAlerts: true,
        weeklySummaries: false,
    });

    const [emailInput, setEmailInput] = useState('');
    const [showEmailForm, setShowEmailForm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    const hasEmail = preferences.email !== null && preferences.email !== '';

    const handleToggle = (key: keyof Omit<NotificationPreferences, 'email' | 'emailVerified'>) => {
        setPreferences((prev) => ({
            ...prev,
            [key]: !prev[key],
        }));
    };

    const handleSaveEmail = async () => {
        if (!emailInput || !emailInput.includes('@')) return;
        setSaving(true);
        setSaveError(null);
        setSaveSuccess(false);

        try {
            // In production, this would be:
            // await fetch('/api/v1/notifications/email/preferences/{address}', {
            //   method: 'PUT',
            //   headers: { 'Content-Type': 'application/json' },
            //   body: JSON.stringify({ email: emailInput, ...preferences }),
            // })

            // Simulate API call
            await new Promise((resolve) => setTimeout(resolve, 500));

            setPreferences((prev) => ({ ...prev, email: emailInput }));
            setShowEmailForm(false);
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch {
            setSaveError('Failed to save email. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    const handleRemoveEmail = async () => {
        setSaving(true);
        try {
            // Simulate API call
            await new Promise((resolve) => setTimeout(resolve, 500));

            setPreferences((prev) => ({ ...prev, email: null, emailVerified: false }));
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch {
            setSaveError('Failed to remove email.');
        } finally {
            setSaving(false);
        }
    };

    const handleSavePreferences = async () => {
        setSaving(true);
        setSaveError(null);
        setSaveSuccess(false);

        try {
            // In production:
            // await fetch('/api/v1/notifications/email/preferences/{address}', {
            //   method: 'PUT',
            //   headers: { 'Content-Type': 'application/json' },
            //   body: JSON.stringify({ ...preferences }),
            // })

            await new Promise((resolve) => setTimeout(resolve, 400));
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch {
            setSaveError('Failed to save preferences.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Email Configuration */}
            <Card className="border border-white/[0.08] bg-white/[0.03] p-6 backdrop-blur-md">
                <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
                        <Mail className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h3 className="font-heading text-lg font-bold text-white">Email Notifications</h3>
                        <p className="font-mono text-xs text-white/40 mt-1">
                            Receive email alerts for important events on your StellarStream account.
                        </p>

                        {hasEmail ? (
                            <div className="mt-4 space-y-3">
                                <div className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                                    <Mail className="h-4 w-4 text-cyan-400" />
                                    <span className="font-mono text-sm text-white/70 flex-1">{preferences.email}</span>
                                    {preferences.emailVerified ? (
                                        <Badge variant="success" dot size="sm">
                                            Verified
                                        </Badge>
                                    ) : (
                                        <Badge variant="warning" dot size="sm">
                                            Unverified
                                        </Badge>
                                    )}
                                    <button
                                        onClick={() => {
                                            setEmailInput(preferences.email || '');
                                            setShowEmailForm(true);
                                        }}
                                        className="font-mono text-[10px] uppercase tracking-wider text-cyan-400 hover:text-cyan-300 transition-colors"
                                    >
                                        Change
                                    </button>
                                    <button
                                        onClick={handleRemoveEmail}
                                        disabled={saving}
                                        className="font-mono text-[10px] uppercase tracking-wider text-red-400 hover:text-red-300 transition-colors"
                                    >
                                        Remove
                                    </button>
                                </div>
                            </div>
                        ) : showEmailForm ? (
                            <div className="mt-4 space-y-3">
                                <Input
                                    type="email"
                                    placeholder="your@email.com"
                                    value={emailInput}
                                    onChange={(e) => setEmailInput(e.target.value)}
                                    label="Email Address"
                                />
                                <div className="flex gap-2">
                                    <Button
                                        onClick={handleSaveEmail}
                                        isLoading={saving}
                                        className="bg-cyan-500 hover:bg-cyan-600 text-black font-semibold"
                                    >
                                        Save Email
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={() => {
                                            setShowEmailForm(false);
                                            setEmailInput('');
                                        }}
                                        className="border-white/20"
                                    >
                                        Cancel
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <Button
                                onClick={() => setShowEmailForm(true)}
                                variant="outline"
                                size="sm"
                                className="mt-4 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                                icon={<Mail className="h-4 w-4" />}
                            >
                                Add Email Address
                            </Button>
                        )}
                    </div>
                </div>

                {saveSuccess && (
                    <Alert variant="success" className="mt-4" closable onClose={() => setSaveSuccess(false)}>
                        Preferences saved successfully.
                    </Alert>
                )}

                {saveError && (
                    <Alert variant="error" className="mt-4" closable onClose={() => setSaveError(null)}>
                        {saveError}
                    </Alert>
                )}
            </Card>

            {/* Notification Type Toggles */}
            <Card className="border border-white/[0.08] bg-white/[0.03] p-6 backdrop-blur-md">
                <div className="flex items-center gap-3 mb-4">
                    <Bell className="h-5 w-5 text-cyan-400" />
                    <div>
                        <h3 className="font-heading text-lg font-bold text-white">Notification Types</h3>
                        <p className="font-mono text-xs text-white/40">
                            Choose which events trigger email notifications.
                        </p>
                    </div>
                </div>

                <div className="space-y-1">
                    <PreferenceRow
                        icon={<CheckCircle2 className="h-4 w-4" />}
                        label="Payment Confirmations"
                        description="When a payment is sent or received on your account"
                        enabled={preferences.paymentConfirmations}
                        onChange={() => handleToggle('paymentConfirmations')}
                    />
                    <PreferenceRow
                        icon={<RefreshCw className="h-4 w-4" />}
                        label="Stream Status Updates"
                        description="When a stream is created, paused, completed, or cancelled"
                        enabled={preferences.streamStatusUpdates}
                        onChange={() => handleToggle('streamStatusUpdates')}
                    />
                    <PreferenceRow
                        icon={<Shield className="h-4 w-4" />}
                        label="Security Alerts"
                        description="New device logins, permission changes, suspicious activity"
                        enabled={preferences.securityAlerts}
                        onChange={() => handleToggle('securityAlerts')}
                    />
                    <PreferenceRow
                        icon={<BarChart3 className="h-4 w-4" />}
                        label="Weekly Summaries"
                        description="A weekly recap of your streaming activity and stats"
                        enabled={preferences.weeklySummaries}
                        onChange={() => handleToggle('weeklySummaries')}
                    />
                </div>

                {hasEmail && (
                    <div className="mt-6 pt-4 border-t border-white/[0.06] flex justify-between items-center">
                        <p className="font-mono text-[10px] text-white/30">
                            Changes are saved to your Stellar address preferences.
                        </p>
                        <Button
                            onClick={handleSavePreferences}
                            isLoading={saving}
                            size="sm"
                            className="bg-cyan-500 hover:bg-cyan-600 text-black font-semibold"
                        >
                            Save Preferences
                        </Button>
                    </div>
                )}
            </Card>

            {/* Delivery History */}
            <Card className="border border-white/[0.08] bg-white/[0.03] p-6 backdrop-blur-md">
                <DeliveryHistoryCard />
            </Card>
        </div>
    );
}

