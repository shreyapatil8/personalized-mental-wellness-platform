import { loadCounsellingHistory, saveCounsellingMessage } from "../services/counsellingChatService.js";
import { publishCounsellingMessage } from "../services/counsellingSocketService.js";

export async function getCounsellingChat(req, res, next) {
  try { res.json(await loadCounsellingHistory(req.user, req.params.id, req.query)); }
  catch (error) { next(error); }
}

export async function postCounsellingMessage(req, res, next) {
  try {
    const message = await saveCounsellingMessage(req.user, req.params.id, req.body);
    await publishCounsellingMessage(req.params.id, message);
    res.status(201).json({ message });
  } catch (error) { next(error); }
}
