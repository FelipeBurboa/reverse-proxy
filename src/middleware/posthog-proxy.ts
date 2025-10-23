import { Request, Response, NextFunction } from "express";

const API_HOST = process.env.POSTHOG_API_HOST || "us.i.posthog.com";
const ASSET_HOST = process.env.POSTHOG_ASSET_HOST || "us-assets.i.posthog.com";

const toHeaders = (
  headers: Record<string, string | string[] | undefined>
): Headers => {
  const fetchHeaders = new Headers();

  Object.entries(headers).forEach(([name, values]) => {
    if (!values) return;

    const valueArray = Array.isArray(values) ? values : [values];
    valueArray.forEach((value) => {
      if (value) fetchHeaders.append(name, value);
    });
  });

  return fetchHeaders;
};

const fromHeaders = (headers: Headers): Record<string, string> => {
  const nodeHeaders: Record<string, string> = {};

  headers.forEach((value, name) => {
    nodeHeaders[name] = value;
  });

  return nodeHeaders;
};

export const posthogProxy = () => {
  return async (
    req: Request,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    try {
      // Express already stripped the prefix, so req.url is the pathname
      const pathname = req.url;
      const posthogHost = pathname.startsWith("/static/")
        ? ASSET_HOST
        : API_HOST;

      console.log(
        `[PostHog Proxy] ${req.method} ${pathname} -> https://${posthogHost}${pathname}`
      );

      // Build headers
      const headers = toHeaders(req.headers);
      headers.set("host", posthogHost);

      if (req.headers.host) {
        headers.set("X-Forwarded-Host", req.headers.host);
      }

      // Get client IP
      const clientIp =
        (req.headers["x-forwarded-for"] as string)?.split(",")[0] ||
        req.ip ||
        req.socket.remoteAddress ||
        "";

      if (clientIp) {
        headers.set("X-Real-IP", clientIp);
        headers.set("X-Forwarded-For", clientIp);
      }

      // Remove sensitive or hop-by-hop headers
      headers.delete("cookie");
      headers.delete("connection");

      // Delete content-length and transfer-encoding - let fetch recalculate from body
      headers.delete("content-length");
      headers.delete("transfer-encoding");

      // Prepare fetch options
      const fetchOptions: RequestInit = {
        method: req.method,
        headers,
      };

      // Add body for POST/PUT/PATCH requests
      if (req.method && !["HEAD", "GET"].includes(req.method)) {
        fetchOptions.body = req.body;
      }

      // Make the request to PostHog
      const response = await fetch(
        new URL(pathname, `https://${posthogHost}`),
        fetchOptions
      );

      // Get response body and headers
      const responseHeaders = new Headers(response.headers);
      const body = await response.text();

      console.log(`[PostHog Proxy] Response: ${response.status}`);

      // Handle content-encoding issues
      if (responseHeaders.has("content-encoding")) {
        responseHeaders.delete("content-encoding");
        responseHeaders.delete("content-length");
      }

      // Set response status and headers
      res.status(response.status);
      Object.entries(fromHeaders(responseHeaders)).forEach(([name, value]) => {
        res.setHeader(name, value);
      });

      res.send(body);
    } catch (error) {
      console.error("[PostHog Proxy] Error:", error);
      res.status(502).json({ error: "Bad gateway" });
    }
  };
};
