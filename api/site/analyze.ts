import { handleVercelRequest } from "../../server/vercel-hosted.ts";

export const config = { maxDuration: 60 };

export default {
  fetch: handleVercelRequest,
};
