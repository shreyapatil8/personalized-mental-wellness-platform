import nodemailer from "nodemailer";

const missingConfigurationMessage = "Password reset email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM in backend/.env. Use a Gmail App Password for SMTP_PASSWORD.";

export function smtpConfiguration() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASSWORD || !SMTP_FROM) {
    const error = new Error(missingConfigurationMessage);
    error.statusCode = 503;
    throw error;
  }

  const port = Number(SMTP_PORT);
  if (SMTP_HOST !== "smtp.gmail.com" || port !== 465) {
    const error = new Error("Gmail SMTP must use SMTP_HOST=smtp.gmail.com and SMTP_PORT=465 with implicit TLS.");
    error.statusCode = 503;
    throw error;
  }

  const user = SMTP_USER.trim();
  const from = SMTP_FROM.trim();
  if (!user.includes("@") || from.toLowerCase() !== user.toLowerCase()) {
    const error = new Error("Set SMTP_USER to the Gmail sender address and use the same address in SMTP_FROM.");
    error.statusCode = 503;
    throw error;
  }
  return { host: SMTP_HOST, port, user, password: SMTP_PASSWORD.replace(/\s+/g, ""), from };
}

export function createGmailTransport(config = smtpConfiguration()) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: true,
    auth: { user: config.user, pass: config.password },
    tls: { minVersion: "TLSv1.2" },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000
  });
}

export async function sendPasswordResetEmail(email, resetUrl) {
  const config = smtpConfiguration();
  const transporter = createGmailTransport(config);
  try {
    const result = await transporter.sendMail({
      from: config.from,
      to: email,
      subject: "Reset your Wellspace password",
      text: [
        "We received a request to reset your Wellspace password.",
        "This link expires in 30 minutes and can only be used once:",
        "",
        resetUrl,
        "",
        "If you did not request this, you can ignore this email."
      ].join("\n")
    });
    if (!result.accepted?.some((address) => String(address).toLowerCase() === email.toLowerCase()) || result.rejected?.length) {
      throw new Error("SMTP server did not accept the recipient.");
    }
  } catch {
    const error = new Error("Password reset email delivery failed. Check SMTP_USER, the Gmail App Password in SMTP_PASSWORD, and Gmail account access.");
    error.statusCode = 502;
    throw error;
  }
}

export { missingConfigurationMessage };
