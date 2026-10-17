import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { authorizeCounsellingChat, saveCounsellingMessage, sessionDetails } from "./counsellingChatService.js";

let server;
const roomName = (id) => `counselling:${id}`;

async function socketUser(socket) {
  const payload = jwt.verify(socket.handshake.auth.token, process.env.JWT_SECRET);
  const user = await User.findById(payload.sub);
  if (!user?.isActive) throw new Error("Your session has expired. Please sign in again.");
  return user;
}

function errorResponse(error) {
  return { ok: false, message: error.name === "ZodError" ? "Enter a message of 1–2000 characters with a valid message identifier." :
    error.statusCode ? error.message : "The session is unavailable. Reconnect or sign in again.", status: error.statusCode || 400 };
}

export function configureCounsellingSockets(io, socket) {
  server = io;
  socket.on("counselling:join", async (payload, acknowledge) => {
    const reply = typeof acknowledge === "function" ? acknowledge : () => {};
    try {
      const appointment = await authorizeCounsellingChat(await socketUser(socket), payload?.appointmentId);
      // A socket displays one session; switching sessions removes its old membership.
      for (const room of socket.rooms) if (room.startsWith("counselling:")) await socket.leave(room);
      await socket.join(roomName(String(appointment._id)));
      reply({ ok: true, session: sessionDetails(appointment) });
    } catch (error) { reply(errorResponse(error)); }
  });
  socket.on("counselling:leave", (payload, acknowledge) => {
    if (typeof payload?.appointmentId === "string") socket.leave(roomName(payload.appointmentId));
    if (typeof acknowledge === "function") acknowledge({ ok: true });
  });
  socket.on("counselling:send", async (payload, acknowledge) => {
    const reply = typeof acknowledge === "function" ? acknowledge : () => {};
    try {
      const message = await saveCounsellingMessage(await socketUser(socket), payload?.appointmentId, payload);
      await publishCounsellingMessage(payload.appointmentId, message);
      reply({ ok: true, message });
    } catch (error) { reply(errorResponse(error)); }
  });
}

export async function publishCounsellingMessage(appointmentId, message) {
  if (!server) return;
  // Revalidate each recipient: an old room join never grants permanent access.
  for (const socket of await server.in(roomName(appointmentId)).fetchSockets()) {
    try {
      await authorizeCounsellingChat(await socketUser(socket), appointmentId);
      socket.emit("counselling:message", message);
    } catch {
      socket.emit("counselling:unavailable", { appointmentId });
      await socket.leave(roomName(appointmentId));
    }
  }
}

export async function notifyCounsellingStatus(appointment) {
  if (!server) return;
  const appointmentId = String(appointment._id);
  for (const socket of await server.in(roomName(appointmentId)).fetchSockets()) {
    try {
      const user = await socketUser(socket);
      if (!["student", "counsellor"].includes(user.role) || String(appointment[user.role]?._id || appointment[user.role]) !== String(user._id)) throw new Error("Not a participant");
      socket.emit("counselling:status", { appointmentId, status: appointment.status });
    } catch { socket.emit("counselling:unavailable", { appointmentId }); }
    if (appointment.status !== "approved") await socket.leave(roomName(appointmentId));
  }
}
