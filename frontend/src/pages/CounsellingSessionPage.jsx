import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { io } from "socket.io-client";
import { API_ORIGIN, api } from "../api/client.js";
import CounsellingSessionHistory from "../components/CounsellingSessionHistory.jsx";
import CounsellorWellnessOverview from "../components/CounsellorWellnessOverview.jsx";
import { useAuth } from "../context/useAuth.js";

export default function CounsellingSessionPage() {
  const { appointmentId } = useParams();
  const { user } = useAuth();
  return <Session key={`${user.id}:${appointmentId}`} appointmentId={appointmentId} />;
}

function Session({ appointmentId }) {
  const { user, token } = useAuth();
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(null);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [olderLoading, setOlderLoading] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [connection, setConnection] = useState("Connecting…");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const socketRef = useRef(null);
  const latestId = useRef(null);
  const transcript = useRef(null);
  const scrollToLatest = useRef(true);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const accessClosed = useRef(false);

  function merge(rows) {
    if (!mounted.current || accessClosed.current) return;
    for (const row of rows) if (!latestId.current || row._id > latestId.current) latestId.current = row._id;
    setMessages((current) => [...new Map([...current, ...rows].map((row) => [row._id, row])).values()]
      .sort((a, b) => a._id.localeCompare(b._id)));
  }

  useEffect(() => {
    mounted.current = true;
    accessClosed.current = false;
    let active = true;
    let terminalStatus;
    const socket = io(API_ORIGIN || "/", { auth: { token }, transports: ["websocket", "polling"] });
    socketRef.current = socket;
    async function synchronize(after) {
      try {
        let cursor = after;
        let more;
        do {
          const { data } = await api.get(`/counselling/appointments/${appointmentId}/chat`, { params: cursor ? { after: cursor } : {} });
          if (!active || accessClosed.current) return;
          setSession(terminalStatus ? { ...data.session, status: terminalStatus, canSend: false } : data.session);
          merge(data.messages);
          if (!cursor) setHasOlder(data.hasMore);
          more = Boolean(cursor && data.hasMore);
          cursor = data.messages.at(-1)?._id;
        } while (more && cursor);
      } catch (err) {
        if (!active) return;
        setError("We couldn’t load this conversation. Check the appointment status or try again.");
        if ([401, 403, 404].includes(err.response?.status)) { latestId.current = null; setHasOlder(false); setSession(null); setMessages([]); socket.disconnect(); }
      } finally { if (active) setLoading(false); }
    }
    synchronize(latestId.current);
    socket.on("connect", () => {
      setConnection("Joining session…");
      const cursor = latestId.current;
      socket.timeout(10000).emit("counselling:join", { appointmentId }, (err, result) => {
        if (!active) return;
        if (err || !result?.ok) {
          setConnection("Connection unavailable");
          if (result && !result.ok) { setError(result.message); latestId.current = null; setHasOlder(false); setSession(null); setMessages([]); }
          return;
        }
        setSession(result.session);
        setConnection("Connected");
        synchronize(cursor);
      });
    });
    socket.on("disconnect", (reason) => {
      if (!active) return;
      setConnection("Reconnecting… You can retry sending if needed.");
      if (reason === "io server disconnect" && !accessClosed.current) socket.connect();
    });
    socket.on("connect_error", () => { if (active) setConnection("Connection unavailable · Trying to reconnect"); });
    socket.on("counselling:message", (message) => {
      if (active && message.appointment === appointmentId) merge([message]);
    });
    socket.on("counselling:status", (event) => {
      if (!active || event.appointmentId !== appointmentId) return;
      terminalStatus = event.status;
      if (event.status === "cancelled") accessClosed.current = true;
      setSession((current) => current && { ...current, status: event.status, canSend: event.status === "approved" });
      if (event.status === "cancelled") { setMessages([]); setPending(null); setDraft(""); setConnection("Session closed"); }
    });
    socket.on("counselling:unavailable", () => {
      if (!active) return;
      accessClosed.current = true;
      setSession(null); setMessages([]); setPending(null); setDraft("");
      setError("This session is no longer available to your account.");
      socket.disconnect();
    });
    return () => {
      active = false; mounted.current = false;
      socket.emit("counselling:leave", { appointmentId }); socket.disconnect(); socketRef.current = null;
    };
  }, [appointmentId, token, attempt]);

  useEffect(() => {
    if (scrollToLatest.current) transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: "auto" });
  }, [messages]);

  async function loadOlder() {
    setOlderLoading(true); setError("");
    const previousHeight = transcript.current?.scrollHeight || 0;
    scrollToLatest.current = false;
    try {
      const { data } = await api.get(`/counselling/appointments/${appointmentId}/chat`, { params: { before: messages[0]._id } });
      if (!mounted.current) return;
      merge(data.messages); setHasOlder(data.hasMore);
      window.requestAnimationFrame(() => { if (transcript.current) transcript.current.scrollTop += transcript.current.scrollHeight - previousHeight; });
    } catch { if (mounted.current) setError("We couldn’t load older messages. Please try again."); }
    finally { if (mounted.current) setOlderLoading(false); }
  }

  async function send(event) {
    event.preventDefault();
    if (inFlight.current || !session?.canSend || (!pending && !draft.trim())) return;
    const outbound = pending || { clientMessageId: window.crypto.randomUUID(), content: draft.trim() };
    inFlight.current = true; setPending(outbound); setSending(true); setError("");
    scrollToLatest.current = true;
    try {
      let message;
      if (socketRef.current?.connected) {
        message = await new Promise((resolve, reject) => {
          socketRef.current.timeout(12000).emit("counselling:send", { appointmentId, ...outbound }, (err, result) => {
            if (err || !result?.ok) reject(new Error(result?.message || "Delivery could not be confirmed."));
            else resolve(result.message);
          });
        });
      } else {
        const { data } = await api.post(`/counselling/appointments/${appointmentId}/chat/messages`, outbound);
        message = data.message;
      }
      if (!mounted.current) return;
      merge([message]); setPending(null); setDraft("");
    } catch {
      if (mounted.current) setError("We couldn’t confirm delivery. Retry the same message safely; it won’t be saved twice.");
    } finally { inFlight.current = false; if (mounted.current) setSending(false); }
  }

  const other = session?.[user.role === "student" ? "counsellor" : "student"];
  return <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[270px_minmax(0,1fr)]">
    <CounsellingSessionHistory appointmentId={appointmentId} status={session?.status} role={user.role} />
    <div className="min-w-0 space-y-5">
    <header className="surface space-y-3 p-4 sm:p-5">
      <Link className="dashboard-text-link" to="/counselling">Back to counselling</Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="section-kicker">Counselling session</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink sm:text-2xl">{other ? other.name : "Counselling conversation"}</h1>
          <p className="mt-1 text-sm text-slate-600">{session && new Date(session.scheduledFor).toLocaleString()}</p>
        </div>
        {session && <span className="status-pill border-slate-200 bg-slate-50 text-slate-700">{session.status.charAt(0).toUpperCase() + session.status.slice(1)}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 pt-2">
        <p role="status" className="text-sm text-sea">{connection}</p>
        {!loading && session?.canSend && connection !== "Connected" && <button className="dashboard-text-link min-h-8" type="button" onClick={() => setAttempt((value) => value + 1)}>Reconnect to session</button>}
        <p className="text-sm text-slate-500">Private conversation with your assigned {user.role === "student" ? "counsellor" : "student"}.</p>
      </div>
    </header>
    {error && <div role="alert" className="notice-error">{error}{!pending && <button className="dashboard-text-link ml-2" onClick={() => { setError(""); setLoading(true); setAttempt((value) => value + 1); }}>Try again</button>}</div>}
    {loading ? <p role="status">Loading your conversation…</p> : session && <>
      {user.role === "counsellor" && <CounsellorWellnessOverview appointment={{ _id: session.id, status: session.status }} />}
      <section className="surface overflow-hidden" aria-label="Private counselling conversation">
        <div className="border-b border-slate-200 p-4 sm:px-6">
          <h2 className="font-semibold">Session chat history</h2>
          <p className="mt-1 text-sm text-slate-600">Messages are saved for both participants. Reopen this appointment to continue or read them after signing in again.</p>
        </div>
        <div ref={transcript} role="log" aria-label="Counselling messages" aria-live="polite" tabIndex={0} onScroll={() => {
          const area = transcript.current; scrollToLatest.current = area.scrollHeight - area.scrollTop - area.clientHeight < 80;
        }} className="h-[45dvh] min-h-64 space-y-5 overflow-y-auto overscroll-contain p-4 sm:p-6">
          {hasOlder && <button className="btn-secondary" disabled={olderLoading} onClick={loadOlder}>{olderLoading ? "Loading…" : "Load older messages"}</button>}
          {!messages.length && <p className="py-8 muted-copy">{session.status === "cancelled" ? "This appointment was cancelled. Chat is no longer available." : "There are no messages yet. When you’re ready, you can start the conversation."}</p>}
          {messages.map((message) => {
            const own = message.sender === user.id;
            return <article key={message._id} data-message-id={message._id} className={`flex ${own ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[92%] rounded-2xl p-4 ${own ? "bg-teal-50" : "bg-stone-50"}`}>
                <p className="text-sm font-medium text-sea">{own ? "You" : other?.name}</p>
                <p className="mt-2 whitespace-pre-wrap break-words leading-7">{message.content}</p>
                <time className="mt-2 block text-sm text-slate-500" dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString()}</time>
              </div>
            </article>;
          })}
        </div>
        {session.canSend ? <form className="space-y-3 border-t border-slate-200 p-4 sm:p-6" onSubmit={send}>
          <label className="block text-sm font-medium" htmlFor="counselling-message">Your message</label>
          <textarea className="input min-h-24 resize-y" id="counselling-message" maxLength={2000} value={draft} disabled={sending || Boolean(pending)} onChange={(event) => setDraft(event.target.value)} placeholder="Share what you feel comfortable sharing…" />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">{draft.length} / 2000</p>
            <button className="btn-primary" disabled={sending || (!pending && !draft.trim())}>{sending ? "Sending…" : pending ? "Retry message" : "Send message"}</button>
          </div>
        </form> : <p className="border-t border-slate-200 p-4 text-sm">{session.status === "completed" ? "This session is complete. You can still read the conversation." : "Chat is closed for this appointment."}</p>}
      </section>
      {user.role === "student" && session.status === "approved" && <p className="text-sm text-slate-600">To share wellness information with your counsellor, enable “Counsellor summary consent” in <Link className="dashboard-text-link" to="/profile">Profile</Link> and “Allow summary sharing” for this appointment in <Link className="dashboard-text-link" to="/counselling">Counselling</Link>. Chat works independently of wellness sharing.</p>}
    </>}
    </div>
  </div>;
}
