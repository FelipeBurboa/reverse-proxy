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

export const posthogProxy = (prefix: string) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    // Only handle requests that start with the prefix
    if (!req.url.startsWith(prefix)) {
      next();
      return;
    }

    try {
      const pathname = req.url.slice(prefix.length);
      const posthogHost = pathname.startsWith("/static/")
        ? ASSET_HOST
        : API_HOST;

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

      // Prepare fetch options
      const fetchOptions: RequestInit = {
        method: req.method,
        headers,
      };

      // Add body for POST/PUT/PATCH requests
      if (req.method && !["HEAD", "GET"].includes(req.method)) {
        fetchOptions.body = JSON.stringify(req.body);
      }

      // Make the request to PostHog
      const response = await fetch(
        new URL(pathname, `https://${posthogHost}`),
        fetchOptions
      );

      // Get response body and headers
      const responseHeaders = new Headers(response.headers);
      const body = await response.text();

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
      console.error("PostHog proxy error:", error);
      next(error);
    }
  };
};
