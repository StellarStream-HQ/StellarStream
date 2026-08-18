export const StreamStateLabels: Record<number, string> = {
  0: "🟢 Active",
  1: "⏸️ Paused",
  2: "✅ Completed",
  3: "🚫 Cancelled",
};

export function formatAddress(address: string, length: number = 8): string {
  if (!address || address.length <= length * 2) return address;
  return `${address.slice(0, length)}...${address.slice(-length)}`;
}

export function formatTimestamp(ts: bigint | number): string {
  const num = Number(ts);
  if (num === 0) return "N/A";
  return new Date(num * 1000).toISOString().replace("T", " ").replace(/\..+/, " UTC");
}

export function formatDuration(seconds: bigint | number): string {
  const s = Number(seconds);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0) parts.push(`${mins}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  return parts.join(" ");
}

export function formatStreamCard(stream: any): string {
  const stateLabel = StreamStateLabels[stream.state] ?? `State (${stream.state})`;
  const duration = formatDuration(BigInt(stream.endTime) - BigInt(stream.startTime) - BigInt(stream.pausedDuration));

  return [
    `┌──────────────────────────────────────────────────────────────┐`,
    `│ 🌊 Stream #${stream.id.toString().padEnd(49)} │`,
    `├──────────────────────────────────────────────────────────────┤`,
    `│ Status:        ${stateLabel.padEnd(46)} │`,
    `│ Sender:        ${formatAddress(stream.sender, 10).padEnd(46)} │`,
    `│ Receiver:      ${formatAddress(stream.receiver, 10).padEnd(46)} │`,
    `│ Token:         ${formatAddress(stream.token, 10).padEnd(46)} │`,
    `│ Total Amount:  ${stream.totalAmount.toString().padEnd(46)} │`,
    `│ Withdrawn:     ${stream.withdrawnAmount.toString().padEnd(46)} │`,
    `│ Start Time:    ${formatTimestamp(stream.startTime).padEnd(46)} │`,
    `│ End Time:      ${formatTimestamp(stream.endTime).padEnd(46)} │`,
    `│ Net Duration:  ${duration.padEnd(46)} │`,
    `└──────────────────────────────────────────────────────────────┘`,
  ].join("\n");
}

export function formatRatesCard(streamId: bigint | number, rates: { ratePerSecond: bigint; ratePerDay: bigint; ratePerMonth: bigint }): string {
  return [
    `┌──────────────────────────────────────────────────────────────┐`,
    `│ ⚡ Streaming Rates for Stream #${streamId.toString().padEnd(38)} │`,
    `├──────────────────────────────────────────────────────────────┤`,
    `│ Per Second:    ${(rates.ratePerSecond.toString() + " stroops/sec").padEnd(46)} │`,
    `│ Per Day:       ${(rates.ratePerDay.toString() + " stroops/day").padEnd(46)} │`,
    `│ Per Month:     ${(rates.ratePerMonth.toString() + " stroops/month (30d)").padEnd(46)} │`,
    `└──────────────────────────────────────────────────────────────┘`,
  ].join("\n");
}
