/**
 * Dashboard Components
 * 
 * Export all dashboard-related components
 */

export { NetWorthStreamVisualizer } from "./NetWorthStreamVisualizer";
export type { StreamData, ChartDataPoint, NetWorthStreamVisualizerProps } from "./NetWorthStreamVisualizer";

// ──────────────────────────────────────────────────────────────
// Organized Dashboard Components (v2 Architecture)
// ──────────────────────────────────────────────────────────────

// Widgets
export { default as StatsCard } from './widgets/StatsCard';
export { default as StreamCard } from './widgets/StreamCard';
export { default as ActivityCard } from './widgets/ActivityCard';
export { default as ProgressCard } from './widgets/ProgressCard';

// Charts
export { default as StreamChart } from './charts/StreamChart';
export { default as BalanceChart } from './charts/BalanceChart';
export { default as HistoryChart } from './charts/HistoryChart';

// Tables
export { default as StreamsTable } from './tables/StreamsTable';
export { default as TransactionTable } from './tables/TransactionTable';

// Forms
export { default as CreateStreamForm } from './forms/CreateStreamForm';
export { default as SettingsForm } from './forms/SettingsForm';
export { default as FilterForm } from './forms/FilterForm';
export type { CreateStreamFormData } from './forms/CreateStreamForm';

// ──────────────────────────────────────────────────────────────
// Original Dashboard Components (preserved for compatibility)
// ──────────────────────────────────────────────────────────────
