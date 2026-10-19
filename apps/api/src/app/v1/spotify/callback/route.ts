import { getServices } from "../../../../server/container";
import { withObservability } from "../../../../server/http/observe";
import { NotFoundError } from "../../../../shared/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUCCESS = "Spotify is linked to Locally. You can close this tab.";
const FAILURE = "Spotify wasn't linked. Close this tab and try again from Locally.";

/** A fixed page: nothing from the request is echoed into it. */
function page(message: string, status: number): Response {
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>Locally</title><style>body{font:16px system-ui,sans-serif;margin:3rem 1.5rem;text-align:center}</style></head>` +
    `<body><p>${message}</p></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** The browser lands here after Spotify's consent screen. No auth: the single-use state is the credential. */
export const GET = withObservability("/v1/spotify/callback", async (request) => {
  const services = await getServices();
  if (!services.spotify) throw new NotFoundError("Not found");

  const params = new URL(request.url).searchParams;
  const result = await services.spotify.callback({
    code: params.get("code"),
    error: params.get("error"),
    state: params.get("state"),
  });
  return result.ok ? page(SUCCESS, 200) : page(FAILURE, 400);
});
