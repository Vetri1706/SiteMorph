import { handleVercelRequest } from "../../server/vercel-hosted.ts";

export const config = { maxDuration: 30 };

export default {
  fetch: handleVercelRequest,
};
