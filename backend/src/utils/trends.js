export function dailyMovingAverage(records, valueField, dateField, windowDays = 7) {
  const byDay = new Map();
  for (const record of records) {
    const value = record[valueField];
    const date = new Date(record[dateField]);
    if (value == null || !Number.isFinite(Number(value)) || !Number.isFinite(date.getTime())) continue;
    const day = date.toISOString().slice(0, 10);
    const values = byDay.get(day) || [];
    values.push(Number(value)); byDay.set(day, values);
  }
  const days = [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => ({ date,
    value: values.reduce((sum, value) => sum + value, 0) / values.length, count: values.length }));
  return days.map((day, index) => {
    const start = new Date(day.date).getTime() - (windowDays - 1) * 86400000;
    const window = days.slice(0, index + 1).filter((item) => new Date(item.date).getTime() >= start);
    return { ...day, value: round(day.value), movingAverage: round(window.reduce((sum, item) => sum + item.value, 0) / window.length), observedDays: window.length };
  });
}
function round(value) { return Math.round(value * 100) / 100; }
