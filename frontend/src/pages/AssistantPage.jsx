import { Loader2, Menu, MessageSquarePlus, Pencil, Send, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useAuth } from "../context/useAuth.js";

const starterPrompts = [
  "I am feeling stressed about exams.",
  "Help me understand my recent mood patterns.",
  "I am struggling to stay motivated.",
  "Help me build a healthy daily routine."
];

export default function AssistantPage() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [collapsed, setCollapsed] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches);
  const [error, setError] = useState("");
  const [failed, setFailed] = useState(null);
  const transcriptRef = useRef(null);
  const activeConversation = useRef("");

  const loadConversations = useCallback(async () => {
    const { data } = await api.get("/chat/conversations");
    setConversations(data.conversations || []);
    return data.conversations || [];
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const rows = await loadConversations();
        if (active && rows.length) await openConversation(rows[0]._id, active);
      } catch { if (active) setError("We couldn’t load your chat history. Please refresh to try again."); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [loadConversations]);

  const openConversation = async (id, active = true) => {
    activeConversation.current = id;
    setConversationId(id);
    setMessages([]);
    setFailed(null);
    setError("");
    const { data } = await api.get(`/chat/conversations/${id}?limit=100`);
    if (active) {
      const rows = data.messages || [];
      setMessages(rows);
      const answered = new Set(rows.map((message) => String(message.replyTo || "")));
      const unanswered = [...rows].reverse().find((message) => message.role === "student" && message.clientMessageId && !answered.has(String(message._id)));
      if (unanswered) {
        setFailed({ text: unanswered.content, clientMessageId: unanswered.clientMessageId });
        setError("A previous reply did not finish. Your message is saved and can be retried.");
      }
    }
  };

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  async function newChat() {
    setLoading(true); setError(""); setMessages([]); setDraft(""); setFailed(null); setConversationId(""); activeConversation.current = "";
    try {
      const { data } = await api.post("/chat/conversations");
      activeConversation.current = data.conversation._id;
      setConversationId(data.conversation._id);
      setConversations((items) => [data.conversation, ...items]);
    } catch { setError("We couldn’t create a new chat. Please try again."); }
    finally { setLoading(false); }
  }

  async function renameChat(item) {
    const title = window.prompt("Rename conversation", item.title);
    if (!title?.trim()) return;
    try {
      const { data } = await api.patch(`/chat/conversations/${item._id}`, { title: title.trim() });
      setConversations((items) => items.map((row) => row._id === item._id ? data.conversation : row));
    } catch { setError("We couldn’t rename this conversation."); }
  }

  async function deleteChat(item) {
    if (!window.confirm(`Delete “${item.title}” and its messages?`)) return;
    try {
      await api.delete(`/chat/conversations/${item._id}`);
      const next = conversations.filter((row) => row._id !== item._id);
      setConversations(next);
      if (conversationId === item._id) {
        setConversationId(""); activeConversation.current = ""; setMessages([]);
        if (next.length) await openConversation(next[0]._id);
      }
    } catch { setError("We couldn’t delete this conversation."); }
  }

  async function sendMessage(text = draft.trim(), retry = false) {
    if (!text || sending) return;
    setSending(true); setError("");
    const clientMessageId = retry && failed ? failed.clientMessageId : globalThis.crypto.randomUUID();
    let id = conversationId;
    try {
      if (!id) {
        const created = await api.post("/chat/conversations");
        id = created.data.conversation._id;
        activeConversation.current = id;
        setConversationId(id);
        setConversations((items) => [created.data.conversation, ...items]);
      }
      if (!retry) {
        setMessages((items) => [...items, { _id: clientMessageId, role: "student", content: text, createdAt: new Date().toISOString(), pending: true }]);
        setDraft("");
      }
      const { data } = await api.post("/chat/messages", { message: text, conversationId: id, clientMessageId });
      if (activeConversation.current !== id) { await loadConversations(); return; }
      setMessages((items) => [...items.filter((item) => item._id !== clientMessageId && item._id !== data.studentMessage._id), data.studentMessage, data.assistantMessage]);
      setFailed(null);
      if (data.context?.usedSources?.length) setMessages((items) => items.map((item) => item._id === data.assistantMessage._id ? { ...item, personalizedWith: data.context.usedSources } : item));
      await loadConversations();
    } catch (requestError) {
      if (id && activeConversation.current !== id) { await loadConversations().catch(() => {}); return; }
      const message = requestError.response?.data?.message || "We couldn’t get a reply. Your message is saved if it reached the server; retry to continue.";
      setFailed({ text, clientMessageId }); setError(message);
      setMessages((items) => items.map((item) => item._id === clientMessageId ? { ...item, pending: false } : item));
    } finally { setSending(false); }
  }

  function submit(event) { event.preventDefault(); sendMessage(); }
  function composerKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(event); }
  }

  if (user?.role !== "student") return <section className="surface p-6"><h1 className="text-2xl font-bold">AI assistant is available for student accounts</h1></section>;

  return <section className="assistant-shell" aria-label="Wellness assistant">
    <aside className={`assistant-sidebar ${collapsed ? "assistant-sidebar-collapsed" : ""}`} aria-label="Chat history">
      <div className="flex items-center justify-between gap-2 p-3">
        {!collapsed && <span className="font-semibold text-slate-700">Your chats</span>}
        <button className="icon-button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "Expand chat history" : "Collapse chat history"} type="button"><Menu size={18} /></button>
      </div>
      <button className="assistant-new-chat" onClick={newChat} type="button"><MessageSquarePlus size={17} />{!collapsed && "New chat"}</button>
      {!collapsed && <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {conversations.map((item) => <div key={item._id} className={`assistant-history-row ${conversationId === item._id ? "assistant-history-active" : ""}`}>
          <button className="min-w-0 flex-1 truncate text-left" onClick={() => openConversation(item._id).catch(() => setError("We couldn’t open this conversation."))} title={item.title} type="button">{item.title || "New chat"}</button>
          <button className="history-action" aria-label={`Rename ${item.title}`} onClick={() => renameChat(item)} type="button"><Pencil size={14} /></button>
          <button className="history-action" aria-label={`Delete ${item.title}`} onClick={() => deleteChat(item)} type="button"><Trash2 size={14} /></button>
        </div>)}
      </div>}
      {!collapsed && <div className="border-t border-slate-200 p-3 text-sm text-slate-600">{user?.name}<div className="text-xs">Student account</div></div>}
    </aside>

    <div className="assistant-main">
      <header className="assistant-heading"><div className="min-w-0"><p className="section-kicker">Your Wellness Assistant</p><h1 className="assistant-conversation-title text-xl font-semibold text-slate-800">{conversations.find((item) => item._id === conversationId)?.title || "A little room to talk"}</h1></div>
        <button className="icon-button md:hidden" onClick={() => setCollapsed((value) => !value)} aria-label="Toggle chat history" type="button"><Menu size={19} /></button>
      </header>
      <div ref={transcriptRef} className="assistant-transcript" role="log" aria-label="Messages" aria-live="polite" aria-busy={loading}>
        {loading && <p role="status" className="m-auto muted-copy">Loading your chat…</p>}
        {!loading && messages.length === 0 && <div className="m-auto w-full max-w-2xl px-5 py-10">
          <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-teal-50 text-sea"><MessageSquarePlus size={23} /></div>
          <h2 className="text-center text-2xl font-semibold text-slate-800">What’s on your mind, {user?.name?.split(" ")[0] || "today"}?</h2>
          <p className="mx-auto mt-3 max-w-xl text-center muted-copy">I can offer supportive wellness guidance and use relevant information you’ve shared in your account when it helps.</p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">{starterPrompts.map((prompt) => <button className="assistant-prompt" key={prompt} onClick={() => sendMessage(prompt)} type="button">{prompt}</button>)}</div>
        </div>}
        {messages.map((message) => <ChatMessage key={message._id} message={message} />)}
        {sending && <div className="assistant-message-row"><div className="assistant-bubble assistant-bubble-ai"><p className="assistant-label">Wellness Assistant</p><span className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />Thinking…</span></div></div>}
      </div>
      {error && <div role="alert" className="notice-error mx-auto mb-2 w-[min(100%-2rem,48rem)]">{error}{failed && <button className="ml-2 min-h-11 font-semibold underline" disabled={sending} onClick={() => sendMessage(failed.text, true)} type="button">Retry</button>}<button className="float-right p-1" aria-label="Dismiss error" onClick={() => setError("")} type="button"><X size={16} /></button></div>}
      <form className="assistant-composer" onSubmit={submit}><div className="assistant-composer-inner">
        <textarea id="assistant-message" aria-label="Message the wellness assistant" className="assistant-input" maxLength={1200} disabled={sending} onChange={(event) => setDraft(event.target.value)} onKeyDown={composerKeyDown} placeholder="Message the wellness assistant…" value={draft} rows={1} />
        <button className="assistant-send" aria-label="Send message" disabled={sending || !draft.trim()} type="submit"><Send size={18} /></button>
      </div><div className="assistant-composer-meta flex justify-between gap-3 px-2 pt-1 text-xs text-slate-500"><span>Enter to send · Shift+Enter for a new line</span><span>{draft.length}/1200</span></div></form>
      <p className="px-4 pb-3 text-center text-xs text-slate-500">Supportive guidance, not a diagnosis or a replacement for professional counselling.</p>
    </div>
  </section>;
}

function ChatMessage({ message }) {
  const student = message.role === "student";
  return <article className={`assistant-message-row ${student ? "assistant-message-user" : ""}`}><div className={`assistant-bubble ${student ? "assistant-bubble-user" : "assistant-bubble-ai"}`}>
    <p className="assistant-label">{student ? "You" : "Wellness Assistant"}</p>
    <div className="whitespace-pre-wrap break-words text-[15px] leading-7">{message.content.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : part.startsWith("`") && part.endsWith("`") ? <code key={index} className="rounded bg-slate-200 px-1">{part.slice(1, -1)}</code> : part)}</div>
    {!student && message.personalizedWith?.length > 0 && <p className="mt-3 text-xs text-teal-800">Personalized using your {message.personalizedWith.map(prettySource).join(", ")}</p>}
    {message.responseSource === "safety_message" && <p className="mt-2 text-xs text-slate-500">Immediate safety support</p>}
  </div></article>;
}
function prettySource(value) { return ({ mood: "recent mood history", mood_pattern: "mood patterns", assessment: "assessment", initial_assessment: "wellness assessment", initial_assessment_detail: "wellness assessment", profile: "profile", journal: "relevant journal context", prediction: "a limited wellness estimate" })[value] || value; }
