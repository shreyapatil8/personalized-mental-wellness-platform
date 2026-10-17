import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useState } from "react";

function Trend({ title, data = [], max, color, mood = false }) {
  const points = data.map((day) => ({ ...day, time: new Date(day.date).getTime() }));
  const dateLabel = (value) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  return <section className="surface p-5">
    <h3 className="text-lg font-medium">{title}</h3>
    {data.length ? <>
      {mood && <p className="mt-2 text-sm leading-6 text-slate-600">1 = very low · 2 = low · 3 = neutral · 4 = good · 5 = great. All feelings are welcome here.</p>}
      {data.length === 1 && <p className="mt-2 muted-copy">One recorded day so far. More check-ins can help you notice changes over time.</p>}
      <div className="mt-4 h-64" role="img" aria-label={`${title}. Values and seven-day averages are also in the table below.`}>
        <ResponsiveContainer width="100%" height="100%"><LineChart data={points} margin={{ top: 8, right: 12, bottom: 10, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} ticks={points.map((day) => day.time)} tickFormatter={dateLabel} minTickGap={24} tick={{ fontSize: 12 }} /><YAxis width={30} domain={[mood ? 1 : 0, max]} allowDecimals={false} />
          <Tooltip labelFormatter={dateLabel} /><Legend /><Line isAnimationActive={false} type="linear" dataKey="value" name="Daily average" stroke={color} strokeWidth={2} dot />
          <Line isAnimationActive={false} type="linear" dataKey="movingAverage" name="7-day average" stroke="#475569" strokeDasharray="5 4" dot={false} />
        </LineChart></ResponsiveContainer>
      </div>
      <details className="mt-3 text-sm"><summary className="min-h-11 cursor-pointer py-2">View chart data</summary>
        <div className="overflow-x-auto"><table className="mt-2 w-full text-left"><caption className="sr-only">{title}: recorded values</caption><thead><tr><th scope="col">Date (UTC)</th><th scope="col">Daily average</th><th scope="col">7-day average</th></tr></thead>
          <tbody>{data.map((day) => <tr key={day.date}><td>{day.date}</td><td>{day.value}</td><td>{day.movingAverage}</td></tr>)}</tbody>
        </table></div>
      </details>
    </> : <p className="mt-3 text-sm text-slate-600">No check-ins here yet. Add one whenever you're ready.</p>}
  </section>;
}
export default function WellnessCharts({ trend }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  return <div className="space-y-5">
    {trend?.moodDaily?.length > 0 && <Trend title="Mood history" data={trend.moodDaily} max={5} color="#0f766e" mood />}
    <p className="text-sm leading-6 text-slate-600">Showing up to your latest 90 check-ins, grouped by day (UTC). The dashed line averages recorded days in the previous seven days. Days without entries are left out; lines connect recorded days, not assumed feelings.</p>
    <details className="overview-disclosure" onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
      <summary>Stress & well-being history</summary>
      {detailsOpen && <div className="mt-4 space-y-5">
        <Trend title="Stress history" data={trend?.stressDaily} max={5} color="#66785a" />
        <Trend title="WHO-5 assessment history" data={trend?.wellnessDaily} max={100} color="#376b88" />
      </div>}
    </details>
  </div>;
}
