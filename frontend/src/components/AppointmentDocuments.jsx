import { useEffect, useState } from "react";
import { api } from "../api/client.js";

export default function AppointmentDocuments({ appointment, role }) {
  const [documents, setDocuments] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [download, setDownload] = useState(null);
  useEffect(() => {
    api.get(`/documents/${appointment._id}`).then(({ data }) => setDocuments(data.documents)).catch(() => setError("Documents unavailable."));
  }, [appointment._id]);
  async function upload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 512000 || file.type !== "application/pdf") { setError("Select a PDF up to 500 KB."); return; }
    setBusy(true); setError("");
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new window.FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = reject; reader.readAsDataURL(file);
      });
      const { data } = await api.post(`/documents/${appointment._id}`, { name: file.name, base64, shareWithCounsellor: consent });
      setDocuments((current) => [data.document, ...current]);
    } catch (err) { setError(err.response?.data?.message || "Upload failed."); }
    finally { setBusy(false); event.target.value = ""; }
  }
  return <details className="mt-3 rounded-lg border p-3 text-sm"><summary className="cursor-pointer font-semibold">Shared documents</summary>
    <p className="mt-2">Optional PDFs stored privately in Cloudinary. The assigned counsellor can access them while this appointment is pending or approved. Download links expire after one minute.</p>
    {role === "student" && ["pending", "approved"].includes(appointment.status) && <div className="my-3 space-y-2">
      <label className="flex gap-2"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />I choose to store this file in Cloudinary and share it with this counsellor.</label>
      <input type="file" accept="application/pdf" aria-label="Share a PDF document" disabled={!consent || busy} onChange={upload} />
    </div>}
    <p role="status">{busy ? "Uploading…" : error}</p>
    {documents.map((document) => <div className="mt-2 flex flex-wrap items-center gap-3" key={document._id}>
      <span>{document.name}</span><button type="button" className="underline" onClick={async () => {
        try { const { data } = await api.post(`/documents/download/${document._id}`); setDownload({ ...data, name: document.name }); }
        catch (err) { setError(err.response?.data?.message || "Download unavailable."); }
      }}>Get download link</button>
      {role === "student" && <button className="text-red-700 underline" type="button" onClick={async () => {
        try { await api.delete(`/documents/${document._id}`); setDocuments((items) => items.filter((item) => item._id !== document._id)); setDownload(null); }
        catch (err) { setError(err.response?.data?.message || "Unable to delete document."); }
      }}>Delete</button>}
    </div>)}
    {download && <a className="mt-3 block font-semibold underline" href={download.url} target="_blank" rel="noreferrer">Download {download.name} (valid for one minute)</a>}
  </details>;
}
