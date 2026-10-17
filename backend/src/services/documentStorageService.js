import { randomUUID } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";

function storage() {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    const error = new Error("Document sharing requires the Cloudinary credentials in the backend configuration.");
    error.statusCode = 503; throw error;
  }
  cloudinary.config({ cloud_name: CLOUDINARY_CLOUD_NAME, api_key: CLOUDINARY_API_KEY, api_secret: CLOUDINARY_API_SECRET, secure: true });
  return cloudinary;
}

export function validatePdf(base64) {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > 512000 || bytes.length < 8 || bytes.subarray(0, 5).toString() !== "%PDF-") {
    const error = new Error("Choose a PDF document no larger than 500 KB.");
    error.statusCode = 400; throw error;
  }
  return bytes;
}

export async function uploadDocument(bytes) {
  const provider = storage();
  return new Promise((resolve, reject) => {
    provider.uploader.upload_stream({ resource_type: "raw", type: "authenticated", public_id: `wellness-research/${randomUUID()}.pdf`,
      overwrite: false, timeout: 25000 }, (error, result) => {
      if (error) { const failure = new Error("Document storage is unavailable. Try again later."); failure.statusCode = 503; reject(failure); }
      else resolve({ publicId: result.public_id, bytes: result.bytes });
    }).end(bytes);
  });
}

export function documentDownloadUrl(publicId) {
  return storage().utils.private_download_url(publicId, "", { resource_type: "raw", type: "authenticated",
    expires_at: Math.floor(Date.now() / 1000) + 60, attachment: true });
}

export async function removeDocument(publicId) {
  const result = await storage().uploader.destroy(publicId, { resource_type: "raw", type: "authenticated", invalidate: true });
  if (!["ok", "not found"].includes(result.result)) {
    const error = new Error("Document could not be removed from storage."); error.statusCode = 503; throw error;
  }
}
