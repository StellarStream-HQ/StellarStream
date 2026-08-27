/**
 * StellarStream Analytics Dashboard Controller
 */

// State
let currentTab = "overview";
let currentTimeframe = "day";
let currentToken = "";
let overviewData = null;
let volumeData = null;
let tvlData = null;
let durationData = null;
let amountData = null;
let withdrawalData = null;
let cancellationData = null;
let retentionData = null;
let gasData = null;
let featureData = null;

// DOM Elements
const kpiTvl = document.getElementById("kpi-tvl");
const kpiTvlChange = document.getElementById("kpi-tvl-change");
const kpiVolume = document.getElementById("kpi-volume");
const kpiVolumeChange = document.getElementById("kpi-volume-change");
const kpiStreams = document.getElementById("kpi-streams");
const kpiCompletedStreams = document.getElementById("kpi-completed-streams");
const kpiDuration = document.getElementById("kpi-duration");
const kpiAvgAmount = document.getElementById("kpi-avg-amount");
const kpiCancellation = document.getElementById("kpi-cancellation");
const kpiCancelledCount = document.getElementById("kpi-cancelled-count");
const kpiGas = document.getElementById("kpi-gas");
const tokenTvlList = document.getElementById("token-tvl-list");

// Tab Navigation
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));

    btn.classList.add("active");
    const tabId = btn.dataset.tab;
    currentTab = tabId;
    const content = document.getElementById(`tab-${tabId}`);
    if (content) {
      content.classList.add("active");
      renderActiveTabCharts();
    }
  });
});

// Controls
document.getElementById("timeframe-select")?.addEventListener("change", (e) => {
  currentTimeframe = e.target.value;
  fetchVolumeData();
});

document.getElementById("token-select")?.addEventListener("change", (e) => {
  currentToken = e.target.value;
  fetchAllData();
});

document.getElementById("refresh-btn")?.addEventListener("click", () => {
  fetchAllData();
});

// Export Modal
const exportModal = document.getElementById("export-modal");
document.getElementById("export-btn")?.addEventListener("click", () => {
  exportModal.classList.add("active");
});

document.getElementById("close-export-modal")?.addEventListener("click", () => {
  exportModal.classList.remove("active");
});

document.getElementById("cancel-export-btn")?.addEventListener("click", () => {
  exportModal.classList.remove("active");
});

document.getElementById("download-export-btn")?.addEventListener("click", () => {
  const type = document.getElementById("export-type-select").value;
  const format = document.querySelector('input[name="export-format"]:checked').value;
  const url = `/api/v1/analytics/export?type=${type}&format=${format}${currentToken ? `&token=${currentToken}` : ""}`;
  window.open(url, "_blank");
  exportModal.classList.remove("active");
});

// Initial Fetch
fetchAllData();
setupLiveEvents();
setInterval(fetchAllData, 15000); // Polling every 15s

async function fetchAllData() {
  await Promise.all([
    fetchOverview(),
    fetchVolumeData(),
    fetchTvlData(),
    fetchDurationData(),
    fetchAmountData(),
    fetchWithdrawalData(),
    fetchCancellationData(),
    fetchRetentionData(),
    fetchGasData(),
    fetchFeatureData(),
    fetchIndexerStatus(),
  ]);
  renderActiveTabCharts();
}

async function fetchOverview() {
  try {
    const res = await fetch("/api/v1/analytics/overview");
    const json = await res.json();
    if (json.success) {
      overviewData = json.data;
      updateKpis(overviewData.summary);
      renderTokenList(overviewData.tokenTvlList);
    }
  } catch (err) {
    console.warn("Error fetching overview:", err);
  }
}

async function fetchVolumeData() {
  try {
    const res = await fetch(`/api/v1/analytics/streams/volume?timeframe=${currentTimeframe}${currentToken ? `&token=${currentToken}` : ""}`);
    const json = await res.json();
    if (json.success) {
      volumeData = json.data;
      drawVolumeChart("streamsVolumeChart", volumeData.buckets);
    }
  } catch (err) {
    console.warn("Error fetching volume data:", err);
  }
}

async function fetchTvlData() {
  try {
    const res = await fetch(`/api/v1/analytics/tvl${currentToken ? `&token=${currentToken}` : ""}`);
    const json = await res.json();
    if (json.success) {
      tvlData = json.data;
      drawTvlChart("tvlOverviewChart", tvlData.timeSeries);
      drawMultiTokenTvlChart("multiTokenTvlChart", tvlData.timeSeries);
    }
  } catch (err) {
    console.warn("Error fetching TVL data:", err);
  }
}

async function fetchDurationData() {
  try {
    const res = await fetch("/api/v1/analytics/streams/duration");
    const json = await res.json();
    if (json.success) {
      durationData = json.data;
      drawDurationChart("durationDistChart", durationData.distribution);
    }
  } catch (err) {
    console.warn("Error fetching duration data:", err);
  }
}

async function fetchAmountData() {
  try {
    const res = await fetch(`/api/v1/analytics/streams/amounts${currentToken ? `&token=${currentToken}` : ""}`);
    const json = await res.json();
    if (json.success) {
      amountData = json.data;
      drawAmountTiersChart("amountTiersChart", amountData.distribution);
      renderPercentiles(amountData.percentiles);
    }
  } catch (err) {
    console.warn("Error fetching amount data:", err);
  }
}

async function fetchWithdrawalData() {
  try {
    const res = await fetch("/api/v1/analytics/withdrawals");
    const json = await res.json();
    if (json.success) {
      withdrawalData = json.data;
      drawWithdrawalTimingChart("withdrawalTimingChart", withdrawalData.timingDistribution);
      drawWithdrawalSizeChart("withdrawalSizeChart", withdrawalData.sizeDistribution);
    }
  } catch (err) {
    console.warn("Error fetching withdrawal data:", err);
  }
}

async function fetchCancellationData() {
  try {
    const res = await fetch("/api/v1/analytics/cancellations");
    const json = await res.json();
    if (json.success) {
      cancellationData = json.data;
      drawCancellationChart("cancellationTrendsChart", cancellationData.cancellationsOverTime);
    }
  } catch (err) {
    console.warn("Error fetching cancellation data:", err);
  }
}

async function fetchRetentionData() {
  try {
    const res = await fetch("/api/v1/analytics/retention");
    const json = await res.json();
    if (json.success) {
      retentionData = json.data;
      renderCohortTable(retentionData.cohorts);
      const uniqueEl = document.getElementById("health-unique-users");
      if (uniqueEl) uniqueEl.textContent = retentionData.totalUniqueUsers.toLocaleString();
    }
  } catch (err) {
    console.warn("Error fetching retention data:", err);
  }
}

async function fetchGasData() {
  try {
    const res = await fetch("/api/v1/analytics/gas");
    const json = await res.json();
    if (json.success) {
      gasData = json.data;
      drawGasActionChart("gasActionChart", gasData.byAction);
      const avgCpuEl = document.getElementById("health-avg-cpu");
      if (avgCpuEl) avgCpuEl.textContent = `${Math.round(gasData.avgCpuPerTx / 1000)}k CPU`;
    }
  } catch (err) {
    console.warn("Error fetching gas data:", err);
  }
}

async function fetchFeatureData() {
  try {
    const res = await fetch("/api/v1/analytics/features");
    const json = await res.json();
    if (json.success) {
      featureData = json.data;
      drawFeatureAdoptionChart("featureAdoptionChart", featureData.features);
    }
  } catch (err) {
    console.warn("Error fetching feature data:", err);
  }
}

async function fetchIndexerStatus() {
  try {
    const res = await fetch("/api/v1/analytics/indexer/status");
    const json = await res.json();
    if (json.success && json.data) {
      const state = json.data.indexerState || json.data;
      const statusText = document.getElementById("indexer-status-text");
      if (statusText) {
        statusText.textContent = `Indexer: ${state.status || "RUNNING"} (Ledger #${(state.lastLedger || 624912).toLocaleString()})`;
      }
    }
  } catch (err) {
    console.warn("Error checking indexer status:", err);
  }
}

function updateKpis(summary) {
  if (!summary) return;
  if (kpiTvl) kpiTvl.textContent = `$${summary.activeTvlFormatted.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  if (kpiVolume) kpiVolume.textContent = `$${summary.totalVolumeFormatted.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  if (kpiStreams) kpiStreams.textContent = `${summary.activeStreamsCount} / ${summary.totalStreamsCreated}`;
  if (kpiCompletedStreams) kpiCompletedStreams.textContent = `${summary.completedStreamsCount} completed`;
  if (kpiDuration) kpiDuration.textContent = summary.averageDurationFormatted || "0s";
  if (kpiAvgAmount) kpiAvgAmount.textContent = `Avg: $${summary.averageStreamAmountFormatted.toLocaleString()}`;
  if (kpiCancellation) kpiCancellation.textContent = `${summary.cancellationRatePercent}%`;
  if (kpiCancelledCount) kpiCancelledCount.textContent = `${summary.cancelledStreamsCount} cancelled`;
  if (kpiGas) kpiGas.textContent = `${summary.totalGasFeesXlmFormatted} XLM`;
}

function renderTokenList(tokens) {
  if (!tokenTvlList || !tokens) return;
  tokenTvlList.innerHTML = tokens
    .map(
      (t) => `
    <div class="token-item">
      <div class="token-info">
        <div class="token-avatar">${t.tokenSymbol.substring(0, 3)}</div>
        <div>
          <div class="token-symbol">${t.tokenSymbol}</div>
          <div class="token-streams">${t.activeStreamCount} active streams</div>
        </div>
      </div>
      <div>
        <div class="token-tvl-val">$${t.activeTvlFormatted.toLocaleString()}</div>
        <div class="token-share">${t.tvlSharePercent}% share</div>
      </div>
    </div>
  `
    )
    .join("");
}

function renderPercentiles(p) {
  const container = document.getElementById("percentiles-container");
  if (!container || !p) return;
  container.innerHTML = `
    <div class="percentile-card"><div class="percentile-tag">25th Percentile</div><div class="percentile-val">$${p.p25}</div></div>
    <div class="percentile-card"><div class="percentile-tag">Median (50th)</div><div class="percentile-val">$${p.p50}</div></div>
    <div class="percentile-card"><div class="percentile-tag">75th Percentile</div><div class="percentile-val">$${p.p75}</div></div>
    <div class="percentile-card"><div class="percentile-tag">90th Percentile</div><div class="percentile-val">$${p.p90}</div></div>
    <div class="percentile-card"><div class="percentile-tag">99th (Whale)</div><div class="percentile-val">$${p.p99}</div></div>
  `;
}

function renderCohortTable(cohorts) {
  const tbody = document.getElementById("cohort-table-body");
  if (!tbody || !cohorts) return;

  const getHeatStyle = (rate) => {
    if (rate >= 75) return "background: rgba(16, 185, 129, 0.35); color: #10b981;";
    if (rate >= 50) return "background: rgba(6, 182, 212, 0.3); color: #06b6d4;";
    if (rate >= 25) return "background: rgba(99, 102, 241, 0.25); color: #818cf8;";
    return "background: rgba(255, 255, 255, 0.04); color: #94a3b8;";
  };

  tbody.innerHTML = cohorts
    .map(
      (c) => `
    <tr>
      <td style="font-weight: 600;">${c.cohortMonth}</td>
      <td>${c.cohortSize}</td>
      <td class="heat-cell" style="${getHeatStyle(c.day1)}">${c.day1}%</td>
      <td class="heat-cell" style="${getHeatStyle(c.day7)}">${c.day7}%</td>
      <td class="heat-cell" style="${getHeatStyle(c.day14)}">${c.day14}%</td>
      <td class="heat-cell" style="${getHeatStyle(c.day30)}">${c.day30}%</td>
      <td class="heat-cell" style="${getHeatStyle(c.day60)}">${c.day60}%</td>
      <td class="heat-cell" style="${getHeatStyle(c.day90)}">${c.day90}%</td>
      <td style="color: var(--accent-emerald);">${c.repeatRate}%</td>
    </tr>
  `
    )
    .join("");
}

// ── Lightweight Canvas Chart Engine ──────────────────────────────────────────

function renderActiveTabCharts() {
  if (currentTab === "overview" && tvlData) {
    drawTvlChart("tvlOverviewChart", tvlData.timeSeries);
    if (volumeData) drawVolumeChart("streamsVolumeChart", volumeData.buckets);
  } else if (currentTab === "tvl-streams" && tvlData) {
    drawMultiTokenTvlChart("multiTokenTvlChart", tvlData.timeSeries);
    if (volumeData) drawVolumeChart("capitalFlowChart", volumeData.buckets);
  } else if (currentTab === "stream-metrics") {
    if (durationData) drawDurationChart("durationDistChart", durationData.distribution);
    if (amountData) drawAmountTiersChart("amountTiersChart", amountData.distribution);
  } else if (currentTab === "withdrawals-cancellations") {
    if (withdrawalData) {
      drawWithdrawalTimingChart("withdrawalTimingChart", withdrawalData.timingDistribution);
      drawWithdrawalSizeChart("withdrawalSizeChart", withdrawalData.sizeDistribution);
    }
    if (cancellationData) drawCancellationChart("cancellationTrendsChart", cancellationData.cancellationsOverTime);
  } else if (currentTab === "gas-features") {
    if (gasData) drawGasActionChart("gasActionChart", gasData.byAction);
    if (featureData) drawFeatureAdoptionChart("featureAdoptionChart", featureData.features);
  }
}

function drawTvlChart(canvasId, series) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !series || series.length === 0) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const values = series.map((s) => s.totalTvlUsdEstimated);
  const max = Math.max(...values, 100);
  const padding = 40;
  const graphW = w - padding * 2;
  const graphH = h - padding * 2;

  // Background grid
  ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padding + (graphH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(w - padding, y);
    ctx.stroke();

    ctx.fillStyle = "#64748b";
    ctx.font = "10px JetBrains Mono";
    ctx.fillText(`$${Math.round(max * (1 - i / 4)).toLocaleString()}`, 4, y + 3);
  }

  // Draw Area gradient
  const step = graphW / Math.max(series.length - 1, 1);
  const gradient = ctx.createLinearGradient(0, padding, 0, h - padding);
  gradient.addColorStop(0, "rgba(6, 182, 212, 0.4)");
  gradient.addColorStop(1, "rgba(6, 182, 212, 0.0)");

  ctx.beginPath();
  series.forEach((s, idx) => {
    const x = padding + idx * step;
    const y = padding + graphH - (s.totalTvlUsdEstimated / max) * graphH;
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(padding + (series.length - 1) * step, h - padding);
  ctx.lineTo(padding, h - padding);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // Draw Line
  ctx.beginPath();
  series.forEach((s, idx) => {
    const x = padding + idx * step;
    const y = padding + graphH - (s.totalTvlUsdEstimated / max) * graphH;
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#06b6d4";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Labels
  series.forEach((s, idx) => {
    if (idx % Math.ceil(series.length / 6) === 0 || idx === series.length - 1) {
      const x = padding + idx * step;
      ctx.fillStyle = "#94a3b8";
      ctx.font = "10px Outfit";
      ctx.fillText(s.timestamp.substring(5), x - 12, h - 15);
    }
  });
}

function drawVolumeChart(canvasId, buckets) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !buckets || buckets.length === 0) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const padding = 35;
  const graphW = w - padding * 2;
  const graphH = h - padding * 2;
  const maxCount = Math.max(...buckets.map((b) => b.count), 5);

  const barWidth = Math.min(30, (graphW / buckets.length) * 0.65);
  const gap = graphW / buckets.length;

  buckets.forEach((b, idx) => {
    const x = padding + idx * gap + (gap - barWidth) / 2;
    const barH = (b.count / maxCount) * graphH;
    const y = padding + graphH - barH;

    const barGrad = ctx.createLinearGradient(0, y, 0, y + barH);
    barGrad.addColorStop(0, "#6366f1");
    barGrad.addColorStop(1, "#3b82f6");

    ctx.fillStyle = barGrad;
    ctx.beginPath();
    ctx.roundRect(x, y, barWidth, barH, [4, 4, 0, 0]);
    ctx.fill();

    // Value on top
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "10px JetBrains Mono";
    ctx.fillText(String(b.count), x + barWidth / 2 - 4, y - 6);

    // Label
    ctx.fillStyle = "#64748b";
    ctx.font = "9px Outfit";
    ctx.fillText(b.period.substring(5), x - 4, h - 12);
  });
}

function drawDurationChart(canvasId, dist) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !dist) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const items = [
    { label: "< 1 Day", val: dist.under1Day, color: "#06b6d4" },
    { label: "1-7 Days", val: dist.day1To7, color: "#3b82f6" },
    { label: "7-30 Days", val: dist.day7To30, color: "#6366f1" },
    { label: "1-3 Months", val: dist.month1To3, color: "#a855f7" },
    { label: "> 3 Months", val: dist.over3Months, color: "#ec4899" },
  ];

  const maxVal = Math.max(...items.map((i) => i.val), 1);
  const rowH = 34;
  const startY = 30;

  items.forEach((item, idx) => {
    const y = startY + idx * (rowH + 12);
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "12px Outfit";
    ctx.fillText(item.label, 20, y + 16);

    const barX = 110;
    const maxBarW = w - barX - 60;
    const barW = Math.max(8, (item.val / maxVal) * maxBarW);

    ctx.fillStyle = item.color;
    ctx.beginPath();
    ctx.roundRect(barX, y, barW, rowH, [6, 6, 6, 6]);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.font = "11px JetBrains Mono";
    ctx.fillText(`${item.val} streams`, barX + barW + 10, y + 22);
  });
}

function drawAmountTiersChart(canvasId, dist) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !dist) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const items = [
    { label: "Micro (< $10)", val: dist.microStreams, color: "#10b981" },
    { label: "Small ($10-$100)", val: dist.smallStreams, color: "#06b6d4" },
    { label: "Medium ($100-$1k)", val: dist.mediumStreams, color: "#6366f1" },
    { label: "Large ($1k-$10k)", val: dist.largeStreams, color: "#f59e0b" },
    { label: "Whale (> $10k)", val: dist.whaleStreams, color: "#f43f5e" },
  ];

  const maxVal = Math.max(...items.map((i) => i.val), 1);
  const rowH = 34;
  const startY = 30;

  items.forEach((item, idx) => {
    const y = startY + idx * (rowH + 12);
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "12px Outfit";
    ctx.fillText(item.label, 20, y + 16);

    const barX = 140;
    const maxBarW = w - barX - 60;
    const barW = Math.max(8, (item.val / maxVal) * maxBarW);

    ctx.fillStyle = item.color;
    ctx.beginPath();
    ctx.roundRect(barX, y, barW, rowH, [6, 6, 6, 6]);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.font = "11px JetBrains Mono";
    ctx.fillText(`${item.val}`, barX + barW + 10, y + 22);
  });
}

function drawWithdrawalTimingChart(canvasId, timing) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !timing) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const items = [
    { label: "Q1 (0-25%)", val: timing.firstQuarter, color: "#06b6d4" },
    { label: "Q2 (25-50%)", val: timing.secondQuarter, color: "#3b82f6" },
    { label: "Q3 (50-75%)", val: timing.thirdQuarter, color: "#6366f1" },
    { label: "Q4 (75-100%)", val: timing.fourthQuarter, color: "#10b981" },
    { label: "Post-End (>100%)", val: timing.afterCompletion, color: "#f59e0b" },
  ];

  const maxVal = Math.max(...items.map((i) => i.val), 1);
  const gap = (w - 60) / items.length;
  const barW = gap * 0.6;

  items.forEach((item, idx) => {
    const x = 40 + idx * gap;
    const barH = (item.val / maxVal) * (h - 90);
    const y = h - 50 - barH;

    ctx.fillStyle = item.color;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, [6, 6, 0, 0]);
    ctx.fill();

    ctx.fillStyle = "#fff";
    ctx.font = "11px JetBrains Mono";
    ctx.fillText(String(item.val), x + barW / 2 - 4, y - 6);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px Outfit";
    ctx.fillText(item.label, x - 4, h - 25);
  });
}

function drawWithdrawalSizeChart(canvasId, size) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !size) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const items = [
    { label: "Micro (< 10%)", val: size.micro, color: "#10b981" },
    { label: "Partial (10-50%)", val: size.partial, color: "#06b6d4" },
    { label: "Majority (50-90%)", val: size.majority, color: "#6366f1" },
    { label: "Lump Sum (> 90%)", val: size.lumpSum, color: "#a855f7" },
  ];

  const total = items.reduce((sum, i) => sum + i.val, 0) || 1;
  const cx = w / 2;
  const cy = h / 2 - 10;
  const radius = Math.min(cx, cy) - 30;

  let startAngle = -Math.PI / 2;
  items.forEach((item) => {
    const slice = (item.val / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle, startAngle + slice);
    ctx.closePath();
    ctx.fillStyle = item.color;
    ctx.fill();
    startAngle += slice;
  });

  // Inner cutout (Donut)
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = "#0f1422";
  ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.font = "14px JetBrains Mono";
  ctx.textAlign = "center";
  ctx.fillText(`${total} total`, cx, cy + 5);
  ctx.textAlign = "left";
}

function drawCancellationChart(canvasId, trends) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !trends || trends.length === 0) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const padding = 40;
  const graphW = w - padding * 2;
  const graphH = h - padding * 2;
  const maxRate = Math.max(...trends.map((t) => t.ratePercent), 10);
  const step = graphW / Math.max(trends.length - 1, 1);

  ctx.beginPath();
  trends.forEach((t, idx) => {
    const x = padding + idx * step;
    const y = padding + graphH - (t.ratePercent / maxRate) * graphH;
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#f43f5e";
  ctx.lineWidth = 3;
  ctx.stroke();

  trends.forEach((t, idx) => {
    const x = padding + idx * step;
    const y = padding + graphH - (t.ratePercent / maxRate) * graphH;

    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#f43f5e";
    ctx.fill();

    ctx.fillStyle = "#fff";
    ctx.font = "10px JetBrains Mono";
    ctx.fillText(`${t.ratePercent}%`, x - 10, y - 10);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px Outfit";
    ctx.fillText(t.period, x - 15, h - 15);
  });
}

function drawGasActionChart(canvasId, byAction) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !byAction) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const actions = Object.keys(byAction);
  if (actions.length === 0) return;

  const maxCpu = Math.max(...actions.map((a) => byAction[a].avgCpu), 1000);
  const rowH = 34;
  const startY = 30;

  actions.forEach((act, idx) => {
    const data = byAction[act];
    const y = startY + idx * (rowH + 12);
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "12px Outfit";
    ctx.fillText(act.toUpperCase(), 20, y + 16);

    const barX = 110;
    const maxBarW = w - barX - 90;
    const barW = Math.max(8, (data.avgCpu / maxCpu) * maxBarW);

    ctx.fillStyle = "#06b6d4";
    ctx.beginPath();
    ctx.roundRect(barX, y, barW, rowH, [6, 6, 6, 6]);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.font = "11px JetBrains Mono";
    ctx.fillText(`${data.avgCpu.toLocaleString()} CPU`, barX + barW + 10, y + 22);
  });
}

function drawFeatureAdoptionChart(canvasId, features) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !features || features.length === 0) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const colors = ["#06b6d4", "#6366f1", "#10b981", "#f59e0b", "#a855f7", "#ec4899"];
  const total = features.reduce((sum, f) => sum + f.callCount, 0) || 1;
  const cx = w / 2;
  const cy = h / 2 - 10;
  const radius = Math.min(cx, cy) - 30;

  let startAngle = -Math.PI / 2;
  features.forEach((f, idx) => {
    const slice = (f.callCount / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle, startAngle + slice);
    ctx.closePath();
    ctx.fillStyle = colors[idx % colors.length];
    ctx.fill();
    startAngle += slice;
  });

  // Inner cutout
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = "#0f1422";
  ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.font = "12px JetBrains Mono";
  ctx.textAlign = "center";
  ctx.fillText(`${total} calls`, cx, cy + 5);
  ctx.textAlign = "left";
}

function drawMultiTokenTvlChart(canvasId, series) {
  drawTvlChart(canvasId, series);
}

// ── Real-Time Event Log Stream ───────────────────────────────────────────────

function setupLiveEvents() {
  const eventsContainer = document.getElementById("events-log");
  const clearBtn = document.getElementById("clear-events-btn");
  if (clearBtn && eventsContainer) {
    clearBtn.addEventListener("click", () => {
      eventsContainer.innerHTML = '<div class="kpi-subtext" style="padding: 10px;">Event log cleared. Awaiting new contract events...</div>';
    });
  }

  try {
    const source = new EventSource("/api/v1/analytics/events/live");
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        appendLiveEvent(data);
      } catch (e) {
        console.warn("Malformed SSE payload", e);
      }
    };
  } catch (err) {
    console.warn("SSE not supported or failed", err);
  }
}

function appendLiveEvent(evt) {
  const container = document.getElementById("events-log");
  if (!container) return;

  const item = document.createElement("div");
  item.className = `event-log-item ${evt.topicAction || "create"}`;
  item.innerHTML = `
    <div>
      <strong>${(evt.topicAction || "ACTION").toUpperCase()}</strong>
      <span style="color: var(--text-muted); margin-left: 8px;">Ledger #${evt.ledger}</span>
      <span style="color: var(--text-secondary); margin-left: 8px;">Tx: ${evt.txHash?.substring(0, 10)}...</span>
    </div>
    <div style="font-weight: 600; color: var(--accent-cyan);">
      ${evt.amountFormatted ? `${evt.amountFormatted} ${evt.tokenSymbol || "XLM"}` : ""}
    </div>
  `;
  container.prepend(item);
  if (container.children.length > 50) {
    container.removeChild(container.lastChild);
  }
}
