import { useEffect, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "../api/client.js";
import { useAuth } from "../context/useAuth.js";

const tabs = [["dashboard", "Dashboard"], ["requests", "Counsellor requests"], ["users", "User management"], ["reports", "Usage & reports"], ["satisfaction", "User satisfaction"]];
const features = [["moodCheckIns", "Mood check-ins"], ["journalEntries", "Journal entries"], ["assessments", "Wellness check-ins"], ["assistantMessages", "AI Assistant messages sent by students"], ["appointmentsBooked", "Appointments booked"], ["counsellingMessages", "Counselling messages"], ["completedSessions", "Completed sessions"]];
const title = value => value.charAt(0).toUpperCase() + value.slice(1);
const date = value => value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(new Date(value)) : "Not recorded";
const rating = value => value == null ? "No responses yet" : `${value.toFixed(1)} / 5`;

function useAdminResource(path, revision) {
  const [state, setState] = useState({ data: null, loading: true, error: "" });
  useEffect(() => {
    if (!path) return;
    let current = true;
    setState({ data: null, loading: true, error: "" });
    api.get(path).then(({ data }) => { if (current) setState({ data, loading: false, error: "" }); })
      .catch(error => { if (current) setState({ data: null, loading: false, error: error.response?.data?.message || "Unable to load this information. Please try refreshing." }); });
    return () => { current = false; };
  }, [path, revision]);
  return state;
}

export default function AdminPage() {
  const { user } = useAuth();
  if (user?.role !== "admin") return <section className="surface p-6"><h1 className="text-2xl font-bold">Admin access required</h1><p className="mt-2 muted-copy">This workspace is available only to platform administrators.</p></section>;
  return <AdminWorkspace currentUser={user} />;
}

function AdminWorkspace({ currentUser }) {
  const [tab, setTab] = useState("dashboard");
  const [period, setPeriod] = useState("weekly");
  const [revision, setRevision] = useState(0);
  const [filters, setFilters] = useState({ search: "", role: "", status: "", page: 1 });
  const [requestStatus, setRequestStatus] = useState("pending");
  const [requestPage, setRequestPage] = useState(1);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const overview = useAdminResource(`/admin/overview?period=${period}`, revision);
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== ""));
  const accounts = useAdminResource(tab === "users" ? `/admin/users?${query}` : null, revision);
  const requests = useAdminResource(tab === "requests" ? `/admin/counsellor-requests?reviewStatus=${requestStatus}&page=${requestPage}` : null, revision);
  const summary = overview.data?.overview.summary;
  const report = overview.data?.overview.report;
  const refresh = () => setRevision(value => value + 1);
  const filter = (key, value) => setFilters(current => ({ ...current, [key]: value, page: 1 }));

  async function updateAccount(account, decision) {
    if (busy) return;
    setBusy(account.id); setNotice(""); setActionError("");
    try {
      if (decision) await api.patch(`/admin/counsellor-requests/${account.id}`, { decision });
      else await api.patch(`/admin/users/${account.id}/status`, { isActive: !account.isActive });
      setNotice(`${account.name}: ${decision || (account.isActive ? "deactivated" : "activated")}.`);
      refresh();
    } catch (error) {
      setActionError(error.response?.data?.message || "This change could not be saved. Please try again.");
      if (error.response?.status === 409) refresh();
    } finally { setBusy(""); }
  }

  return <div className="min-w-0 space-y-6">
    <header className="surface flex flex-wrap items-start justify-between gap-4 p-6">
      <div><p className="section-kicker">Platform administration</p><h1 className="mt-2 flex items-center gap-3 text-3xl font-bold"><ShieldCheck className="shrink-0 text-sea" aria-hidden="true" />Admin dashboard</h1>
        <p className="mt-3 max-w-2xl muted-copy">Support your wellness programme: review counsellor requests, manage accounts and understand participation.</p></div>
      <button type="button" className="btn-secondary inline-flex items-center gap-2" disabled={Boolean(busy)} onClick={refresh}><RefreshCw size={16} aria-hidden="true" />Refresh</button>
    </header>
    {notice && <p role="status" className="rounded-lg bg-teal-50 p-3 text-sm text-sea">{notice}</p>}
    {actionError && <p role="alert" className="notice-error">{actionError}</p>}
    {overview.error && <p role="alert" className="notice-error">{overview.error}</p>}
    <section aria-label="Platform summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Metric label="Total students" value={summary?.totalStudents} note="Registered student accounts" />
      <Metric label="Active counsellors" value={summary?.activeCounsellors} note="Accounts enabled to provide support" />
      <Metric label="Pending counsellor requests" value={summary?.pendingCounsellorRequests} note="Awaiting your review" />
      <Metric label="Total users" value={summary?.totalUsers} note="Registered student and counsellor accounts" />
      <Metric label="User feedback" value={summary ? rating(summary.satisfaction.averageRating) : undefined} note={summary ? `${summary.satisfaction.responses} responses · ease of use · all time` : "Ease-of-use ratings"} />
    </section>
    <nav aria-label="Admin sections" className="flex flex-wrap gap-2">
      {tabs.map(([key, label]) => <button key={key} type="button" aria-current={tab === key ? "page" : undefined} className={tab === key ? "btn-primary" : "btn-secondary"} onClick={() => setTab(key)}>{label}</button>)}
    </nav>

    {tab === "dashboard" && <section className="surface p-5 sm:p-6">
      <h2 className="text-xl font-bold">Programme at a glance</h2>
      <p className="mt-2 muted-copy">Account status shows who can sign in. Participation below reflects saved activity, rather than account status.</p>
      {overview.loading ? <Loading /> : report && <>
        <ReportSummary report={report} />
        <div className="mt-5 flex flex-wrap gap-3"><button className="btn-secondary" onClick={() => setTab("requests")}>Review counsellor requests</button><button className="btn-secondary" onClick={() => setTab("reports")}>View weekly and monthly reports</button></div>
      </>}
      <p className="mt-5 border-t border-slate-100 pt-4 text-sm text-slate-500">Only account details and combined usage totals are shown here. Personal wellness entries and private conversations remain private.</p>
    </section>}

    {tab === "requests" && <section className="surface p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-bold">Counsellor requests</h2><p className="mt-2 muted-copy">Review the registration information provided by each counsellor.</p></div>
        <Select label="Request status" value={requestStatus} onChange={value => { setRequestStatus(value); setRequestPage(1); }} options={[["pending", "Pending"], ["approved", "Approved"], ["rejected", "Rejected"]]} /></div>
      <ResourceState resource={requests} empty="No counsellor requests in this category.">
        <div className="mt-5 space-y-3">{requests.data?.users.map(account => <article key={account.id} data-user-id={account.id} className="rounded-xl border border-slate-200 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-semibold">{account.name}</h3><p className="break-all text-sm text-slate-500">{account.email}</p></div><Status value={account.reviewStatus} /></div>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3"><div><dt className="font-medium">Qualification</dt><dd className="break-words text-slate-600">{account.qualification || "Not provided"}</dd></div><div><dt className="font-medium">Specialization</dt><dd className="break-words text-slate-600">{account.specialization.join(", ") || "Not provided"}</dd></div><div><dt className="font-medium">Registered</dt><dd className="text-slate-600">{date(account.createdAt)}</dd></div></dl>
          {!account.reviewRecorded && <p className="mt-3 text-xs text-slate-500">No review decision was previously recorded. Status reflects existing account access and sign-in history; inactive accounts with no sign-in history need review.</p>}
          {account.reviewStatus === "pending" ? <div className="mt-4 flex flex-wrap gap-2"><button className="btn-primary" disabled={Boolean(busy)} aria-label={`Approve ${account.name}`} onClick={() => updateAccount(account, "approved")}>Approve</button><button className="btn-secondary" disabled={Boolean(busy)} aria-label={`Reject ${account.name}`} onClick={() => updateAccount(account, "rejected")}>Reject</button></div> : <p className="mt-3 text-sm text-slate-600">Account: {account.isActive ? "Active" : "Inactive"}</p>}
        </article>)}</div>
      </ResourceState>
      <Pagination data={requests.data?.pagination} disabled={requests.loading || Boolean(busy)} onPage={setRequestPage} />
    </section>}

    {tab === "users" && <section className="surface p-5 sm:p-6">
      <h2 className="text-xl font-bold">User management</h2><p className="mt-2 muted-copy">Manage access using basic account records.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3"><label className="text-sm font-medium">Search name or email<input className="input mt-1" value={filters.search} onChange={event => filter("search", event.target.value)} placeholder="Search users" /></label>
        <Select label="Role" value={filters.role} onChange={value => filter("role", value)} options={[["", "All roles"], ["student", "Students"], ["counsellor", "Counsellors"], ["admin", "Admins"]]} />
        <Select label="Account status" value={filters.status} onChange={value => filter("status", value)} options={[["", "All statuses"], ["active", "Active"], ["inactive", "Inactive"]]} /></div>
      <ResourceState resource={accounts} empty="No users match these filters.">
        <div className="mt-4 divide-y divide-slate-200">{accounts.data?.users.map(account => <article key={account.id} data-user-id={account.id} className="grid gap-3 py-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] md:items-center">
          <div className="min-w-0"><h3 className="break-words font-semibold">{account.name}</h3><p className="break-all text-sm text-slate-500">{account.email}</p><div className="mt-2 flex flex-wrap items-center gap-2 text-sm"><span>{title(account.role)}</span><Status value={account.isActive ? "active" : "inactive"} />{account.reviewStatus && <span className="text-xs text-slate-500">Request: {title(account.reviewStatus)}</span>}</div></div>
          <div className="text-sm text-slate-600"><p>Registered: {date(account.createdAt)}</p><p className="mt-1">Last sign-in: {date(account.lastLoginAt)}</p></div>
          {account.reviewStatus === "pending" ? <button className="btn-secondary w-fit" onClick={() => { setRequestStatus("pending"); setRequestPage(1); setTab("requests"); }}>Review request</button> : <button className="btn-secondary w-fit" disabled={Boolean(busy) || account.id === currentUser.id} aria-label={`${account.isActive ? "Deactivate" : "Activate"} ${account.name}`} onClick={() => updateAccount(account)}>{account.id === currentUser.id ? "Your account" : account.isActive ? "Deactivate" : "Activate"}</button>}
        </article>)}</div>
      </ResourceState>
      <Pagination data={accounts.data?.pagination} disabled={accounts.loading || Boolean(busy)} onPage={page => setFilters(current => ({ ...current, page }))} />
    </section>}

    {["reports", "satisfaction"].includes(tab) && <section className="surface min-w-0 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-bold">{tab === "reports" ? "Platform usage & reports" : "User satisfaction"}</h2><p className="mt-2 muted-copy">{period === "weekly" ? "Weekly report · last 7 days" : "Monthly report · last 30 days"}</p></div>
        <div className="flex gap-2" role="group" aria-label="Report period">{["weekly", "monthly"].map(value => <button key={value} aria-pressed={period === value} className={period === value ? "btn-primary" : "btn-secondary"} onClick={() => setPeriod(value)}>{title(value)}</button>)}</div></div>
      {overview.loading ? <Loading /> : report && <>
        <p className="mt-3 text-sm text-slate-500">{date(report.start)} – {date(report.end)} · India time · compared with the preceding {report.days} days</p>
        {tab === "reports" ? <>
          <ReportSummary report={report} />
          <div className="mt-5 grid gap-3 sm:grid-cols-3"><Metric label="Active students" value={report.current.activeStudents} note={change(report.current.activeStudents, report.previous.activeStudents)} /><Metric label="New users" value={report.current.newUsers} note={change(report.current.newUsers, report.previous.newUsers)} /><Metric label="Recorded activities" value={report.current.totalActivities} note={change(report.current.totalActivities, report.previous.totalActivities)} /></div>
          <div className="mt-5 overflow-x-auto"><table className="w-full text-left text-sm"><caption className="mb-3 text-left font-semibold">Which features are being used?</caption><thead><tr className="border-b"><th className="py-2 pr-3">Feature</th><th className="px-3">This period</th><th className="px-3">Previous</th><th className="px-3">Change</th></tr></thead><tbody>{features.map(([key, label]) => <tr className="border-b border-slate-100" key={key}><th scope="row" className="py-3 pr-3 font-normal">{label}</th><td className="px-3">{report.current[key]}</td><td className="px-3">{report.previous[key]}</td><td className="px-3">{change(report.current[key], report.previous[key])}</td></tr>)}</tbody></table></div>
          <ActivityChart daily={report.daily} />
          <p className="mt-4 text-sm text-slate-500">Active students are distinct students with saved activity or a completed session in this period, not just enabled accounts. Activities count saved check-ins, journals, student messages to the assistant, counselling messages from either participant and bookings. Completed sessions use their scheduled date and current status; they are shown separately from activity totals.</p>
        </> : <Satisfaction report={report} />}
        <p className="mt-4 border-t border-slate-100 pt-4 text-sm text-slate-500">Reports use retained records only. Deleted entries and browsing without saved activity are not counted. Daily totals at the beginning and end of a report may cover part of a day. Full historical sign-in and session-completion times are not recorded.</p>
      </>}
    </section>}
  </div>;
}

function ReportSummary({ report }) {
  const { current, previous } = report;
  const used = features.filter(([key]) => current[key] > 0).map(([, label]) => label.toLowerCase());
  return <div className="mt-5 space-y-2 rounded-xl bg-teal-50 p-4 text-sm leading-6 text-slate-700">
    <p><strong>Participation:</strong> {current.activeStudents} {current.activeStudents === 1 ? "student has" : "students have"} recorded activity in the last {report.days} days; {current.newUsers} new accounts were registered.</p>
    <p><strong>Feature use:</strong> {used.length ? used.join(", ") + "." : "No recorded feature activity in this period."}</p>
    <p><strong>Usage change:</strong> {change(current.totalActivities, previous.totalActivities)} compared with the previous {report.days} days.</p>
    <p><strong>User feedback:</strong> {current.satisfaction.responses ? `${rating(current.satisfaction.averageRating)} for ease of use and ${rating(current.satisfaction.averageHelpfulness)} for helpfulness, from ${current.satisfaction.responses} responses.` : "No responses yet for this period."}</p>
  </div>;
}

function Satisfaction({ report }) {
  const { current, previous } = report;
  const enough = current.satisfaction.responses >= 2 && previous.satisfaction.responses >= 2;
  return <>
    <p className="mt-4 text-sm text-slate-600">Existing voluntary feedback asks about ease of use and helpfulness. These ratings describe user experience; they are not a clinical outcome or a separate satisfaction score.</p>
    {!current.satisfaction.responses ? <p className="mt-5 rounded-lg bg-slate-50 p-4">No responses yet</p> : <div className="mt-5 grid gap-3 sm:grid-cols-3"><Metric label="Average ease-of-use rating" value={rating(current.satisfaction.averageRating)} /><Metric label="Average helpfulness rating" value={rating(current.satisfaction.averageHelpfulness)} /><Metric label="Responses" value={current.satisfaction.responses} note="Response count, not unique people" /></div>}
    <p className="mt-4 text-sm text-slate-600">{enough ? `Ease of use: ${rating(previous.satisfaction.averageRating)} previously → ${rating(current.satisfaction.averageRating)} now. Helpfulness: ${rating(previous.satisfaction.averageHelpfulness)} previously → ${rating(current.satisfaction.averageHelpfulness)} now. Previous period: ${previous.satisfaction.responses} responses. These are descriptive comparisons, not evidence of a significant change.` : "More feedback is needed to compare periods: at least two responses in each period. No trend is inferred from missing responses."}</p>
  </>;
}

function ActivityChart({ daily }) {
  const max = Math.max(0, ...daily.map(row => row.totalActivities));
  if (!max) return <p className="mt-5 rounded-lg bg-slate-50 p-4 text-sm">No recorded activity in this period.</p>;
  return <figure className="mt-6"><figcaption className="font-semibold">Daily platform activity</figcaption><div className="mt-3 flex h-36 items-end gap-1 border-b border-slate-200" role="img" aria-label="Daily recorded activities. Exact totals are available in the daily counts table below.">{daily.map(row => <div key={row.date} title={`${row.date}: ${row.totalActivities} activities`} className="min-w-0 flex-1 rounded-t bg-teal-600" style={{ height: `${row.totalActivities / max * 100}%` }} />)}</div><div className="mt-2 flex justify-between text-xs text-slate-500"><span>{daily[0].date}</span><span>{daily.at(-1).date}</span></div>
    <details className="mt-3 text-sm"><summary className="cursor-pointer text-sea">View daily counts</summary><div className="overflow-x-auto"><table className="mt-2 w-full text-left"><thead><tr><th>Date</th><th>Activities</th><th>New users</th></tr></thead><tbody>{daily.map(row => <tr key={row.date}><td className="py-1">{row.date}</td><td>{row.totalActivities}</td><td>{row.newUsers}</td></tr>)}</tbody></table></div></details>
  </figure>;
}

function change(current, previous) {
  if (!previous) return current ? `${current} recorded; no activity in the previous period` : "No recorded change (0 in both periods)";
  const delta = current - previous;
  return delta ? `${Math.abs(delta)} ${delta > 0 ? "more" : "fewer"} (${Math.abs(delta / previous * 100).toFixed(0)}%)` : "Unchanged";
}
function Metric({ label, value, note }) { return <article className="min-w-0 rounded-xl border border-slate-200 bg-white p-4"><h3 className="text-sm font-medium text-slate-600">{label}</h3><p className="mt-2 break-words text-2xl font-semibold text-sea">{value ?? "—"}</p>{note && <p className="mt-2 text-xs leading-5 text-slate-500">{note}</p>}</article>; }
function Select({ label, options, value, onChange }) { return <label className="text-sm font-medium">{label}<select className="input mt-1" value={value} onChange={event => onChange(event.target.value)}>{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>; }
function Status({ value }) { return <span className={`status-pill w-fit ${["active", "approved"].includes(value) ? "border-teal-200 bg-teal-50 text-sea" : "border-slate-200 bg-slate-50 text-slate-600"}`}>{title(value)}</span>; }
function Loading() { return <p role="status" className="mt-4 text-sm text-slate-500">Loading…</p>; }
function ResourceState({ resource, empty, children }) { return resource.loading ? <Loading /> : resource.error ? <p role="alert" className="notice-error mt-4">{resource.error}</p> : resource.data?.users.length ? children : <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-500">{empty}</p>; }
function Pagination({ data, disabled, onPage }) {
  if (!data?.total) return null;
  return <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"><p>{data.total} accounts · Page {data.page} of {data.pages}</p><div className="flex gap-2"><button className="btn-secondary" disabled={disabled || data.page <= 1} onClick={() => onPage(data.page - 1)}>Previous</button><button className="btn-secondary" disabled={disabled || data.page >= data.pages} onClick={() => onPage(data.page + 1)}>Next</button></div></div>;
}
