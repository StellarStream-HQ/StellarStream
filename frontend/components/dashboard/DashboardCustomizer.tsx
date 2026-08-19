"use client";

import { useState } from "react";
import { BentoGrid, BentoTile, GhostGlassTile } from "@/components/bento/bento-grid-dashboard";

export interface Widget {
  id: string;
  type: string;
  position: number;
  size: "small" | "medium" | "large";
  enabled: boolean;
  config?: Record<string, any>;
}

export interface DashboardLayout {
  id: string;
  name: string;
  description?: string;
  isDefault: boolean;
  widgets: Widget[];
}

interface DashboardCustomizerProps {
  onSaveLayout?: (layout: DashboardLayout) => Promise<void>;
}

const AVAILABLE_WIDGETS = [
  { id: "stream-overview", name: "Stream Overview", description: "Active streams summary" },
  { id: "flow-analytics", name: "Flow Analytics", description: "Volume and flow metrics" },
  { id: "transaction-history", name: "Transaction History", description: "Recent transactions" },
  { id: "compliance-status", name: "Compliance Status", description: "Sanctions screening results" },
  { id: "yield-tracker", name: "Yield Tracker", description: "Earned yield summary" },
  { id: "asset-distribution", name: "Asset Distribution", description: "Holdings by asset" },
  { id: "recent-activity", name: "Recent Activity", description: "Stream and event feed" },
  { id: "performance-metrics", name: "Performance Metrics", description: "Key performance indicators" },
];

export function DashboardCustomizer({ onSaveLayout }: DashboardCustomizerProps) {
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [layoutName, setLayoutName] = useState("My Layout");
  const [isEditMode, setIsEditMode] = useState(false);

  const handleAddWidget = (widgetId: string) => {
    const newWidget: Widget = {
      id: `${widgetId}-${Date.now()}`,
      type: widgetId,
      position: widgets.length,
      size: "medium",
      enabled: true,
    };
    setWidgets([...widgets, newWidget]);
  };

  const handleRemoveWidget = (widgetId: string) => {
    setWidgets(widgets.filter(w => w.id !== widgetId));
  };

  const handleToggleWidget = (widgetId: string) => {
    setWidgets(
      widgets.map(w =>
        w.id === widgetId ? { ...w, enabled: !w.enabled } : w
      )
    );
  };

  const handleSaveLayout = async () => {
    const layout: DashboardLayout = {
      id: `layout-${Date.now()}`,
      name: layoutName,
      isDefault: false,
      widgets,
    };

    if (onSaveLayout) {
      await onSaveLayout(layout);
    }
    setIsEditMode(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Customize Dashboard</h2>
          <p className="text-sm text-white/50 mt-1">
            Add, remove, or arrange widgets to personalize your dashboard
          </p>
        </div>
        <button
          onClick={() => setIsEditMode(!isEditMode)}
          className={`px-4 py-2 rounded-lg font-semibold transition-all ${
            isEditMode
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/50"
              : "bg-white/10 text-white/70 border border-white/10 hover:bg-white/20"
          }`}
        >
          {isEditMode ? "✓ Done Editing" : "✎ Edit"}
        </button>
      </div>

      {isEditMode && (
        <>
          {/* Layout Configuration */}
          <div className="rounded-2xl border border-white/8 bg-white/4 backdrop-blur-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Layout Configuration</h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-white/60 block mb-2">Layout Name</label>
                <input
                  type="text"
                  value={layoutName}
                  onChange={e => setLayoutName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/40 focus:outline-none focus:border-white/30"
                  placeholder="My Custom Layout"
                />
              </div>
              <button
                onClick={handleSaveLayout}
                className="w-full px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 text-black font-semibold hover:opacity-90 transition-all"
              >
                Save Layout
              </button>
            </div>
          </div>

          {/* Available Widgets */}
          <div className="rounded-2xl border border-white/8 bg-white/4 backdrop-blur-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Available Widgets</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {AVAILABLE_WIDGETS.map(widget => (
                <button
                  key={widget.id}
                  onClick={() => handleAddWidget(widget.id)}
                  className="p-4 rounded-lg border border-white/10 bg-white/4 hover:bg-white/8 transition-all text-left group"
                >
                  <p className="font-semibold text-white group-hover:text-emerald-400 transition-colors">
                    + {widget.name}
                  </p>
                  <p className="text-xs text-white/40 mt-1">{widget.description}</p>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Active Widgets */}
      <div className="rounded-2xl border border-white/8 bg-white/4 backdrop-blur-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">
          Active Widgets ({widgets.length})
        </h3>

        {widgets.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-white/40">No widgets added yet</p>
            {!isEditMode && (
              <button
                onClick={() => setIsEditMode(true)}
                className="mt-4 text-emerald-400 hover:text-emerald-300 text-sm font-semibold"
              >
                Enter edit mode to add widgets
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {widgets.map(widget => (
              <div
                key={widget.id}
                className="flex items-center justify-between p-4 rounded-lg bg-white/5 border border-white/10 hover:border-white/20 transition-all"
              >
                <div className="flex items-center gap-4 flex-1">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={widget.enabled}
                      onChange={() => handleToggleWidget(widget.id)}
                      className="w-4 h-4 rounded cursor-pointer"
                    />
                    <div>
                      <p className="font-semibold text-white">
                        {AVAILABLE_WIDGETS.find(w => w.id === widget.type)?.name || widget.type}
                      </p>
                      <p className="text-xs text-white/40">
                        Size: {widget.size} • Position: {widget.position + 1}
                      </p>
                    </div>
                  </div>
                </div>

                {isEditMode && (
                  <button
                    onClick={() => handleRemoveWidget(widget.id)}
                    className="px-3 py-1 text-sm rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Preview */}
      {!isEditMode && widgets.length > 0 && (
        <div className="rounded-2xl border border-white/8 bg-white/4 backdrop-blur-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Layout Preview</h3>
          <BentoGrid>
            {widgets
              .filter(w => w.enabled)
              .map(widget => (
                <BentoTile key={widget.id} span="1x1" hover>
                  <div className="p-6 h-full flex items-center justify-center">
                    <GhostGlassTile
                      title={AVAILABLE_WIDGETS.find(w => w.id === widget.type)?.name || widget.type}
                      subtitle={AVAILABLE_WIDGETS.find(w => w.id === widget.type)?.description}
                    />
                  </div>
                </BentoTile>
              ))}
          </BentoGrid>
        </div>
      )}
    </div>
  );
}
