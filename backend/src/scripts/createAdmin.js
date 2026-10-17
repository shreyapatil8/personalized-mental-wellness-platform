import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import mongoose from "mongoose";
import { z } from "zod";
import User from "../models/User.js";
import { connectDatabase } from "../config/db.js";

// Operator-only CLI: credentials are never accepted through public registration.
const terminal = new Writable({ write(chunk, encoding, callback) {
  if (!terminal.muted) process.stdout.write(chunk, encoding);
  callback();
} });
const prompt = createInterface({ input: process.stdin, output: terminal, terminal: true });
try {
  const name = await prompt.question("Admin name: ");
  const email = await prompt.question("Admin email: ");
  process.stdout.write("New password (12+ characters; hidden): ");
  terminal.muted = true;
  const password = await prompt.question("");
  terminal.muted = false; process.stdout.write("\n");
  const data = z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().email().toLowerCase(),
    password: z.string().min(12).max(72) }).parse({ name, email, password });
  await connectDatabase(process.env.MONGODB_URI);
  if (await User.exists({ email: data.email })) throw new Error("Account already exists; no role or password was changed.");
  await User.create({ ...data, role: "admin", isActive: true });
  console.log("Admin account created.");
} catch (error) {
  console.error(error.name === "ZodError" ? "Invalid name, email or password length." : error.message);
  process.exitCode = 1;
} finally { prompt.close(); await mongoose.disconnect(); }
