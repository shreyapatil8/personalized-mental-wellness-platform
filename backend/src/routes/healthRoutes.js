import { Router } from "express";

const router = Router();

router.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "personalized-mental-wellness-platform-api",
    timestamp: new Date().toISOString()
  });
});

export default router;
