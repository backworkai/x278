import { createMockPayer } from "../../src/sdk.js";

const payer = createMockPayer();
const port = Number(process.env.X278_PAYER_PORT ?? 8787);

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });

const readJson = async (request: Request): Promise<unknown> => {
  const text = await request.text();
  return text.length > 0 ? JSON.parse(text) : {};
};

const errorResponse = (error: unknown): Response => {
  const reason =
    typeof error === "object" && error !== null && "reason" in error
      ? String((error as { readonly reason: unknown }).reason)
      : "request-failed";
  const message = error instanceof Error ? error.message : String(error);

  return json({ error: { reason, message } }, 400);
};

const routes = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (request.method === "GET" && url.pathname === "/healthz") {
    return json({
      ok: true,
      service: "x278-reference-payer",
      timestamp: new Date().toISOString()
    });
  }

  if (request.method === "GET" && url.pathname === "/.well-known/x278") {
    return json({
      protocol: "x278",
      implementation: "backwork-reference-payer",
      endpoints: {
        authorize: "/authorize",
        resume: "/authorizations/{authId}/resume",
        awaitDetermination: "/determinations/await",
        auditLog: "/audit-log",
        verify: "/verify"
      },
      signing: {
        alg: "EdDSA",
        publicKeyPem: payer.publicKeyPem
      }
    });
  }

  if (request.method === "POST" && url.pathname === "/authorize") {
    return json(await payer.authorize((await readJson(request)) as never));
  }

  const resumeMatch =
    request.method === "POST"
      ? /^\/authorizations\/([^/]+)\/resume$/.exec(url.pathname)
      : null;

  if (resumeMatch) {
    const body = (await readJson(request)) as {
      readonly resumeToken?: unknown;
      readonly evidence?: unknown;
    };

    if (typeof body.resumeToken !== "string") {
      return json(
        {
          error: {
            reason: "invalid-resume-token",
            message: "resumeToken is required"
          }
        },
        400
      );
    }

    const evidence = Array.isArray(body.evidence) ? body.evidence : [];

    return json(
      await payer.resume(
        decodeURIComponent(resumeMatch[1] ?? ""),
        body.resumeToken,
        evidence
      )
    );
  }

  if (request.method === "POST" && url.pathname === "/determinations/await") {
    const body = (await readJson(request)) as {
      readonly subscription?: unknown;
    };

    if (typeof body.subscription !== "string") {
      return json(
        {
          error: {
            reason: "invalid-subscription",
            message: "subscription is required"
          }
        },
        400
      );
    }

    return json(await payer.awaitDetermination(body.subscription));
  }

  if (request.method === "GET" && url.pathname === "/audit-log") {
    return json(await payer.auditLog?.());
  }

  if (request.method === "POST" && url.pathname === "/verify") {
    const body = (await readJson(request)) as {
      readonly request?: unknown;
      readonly determination?: unknown;
    };

    return json({
      valid: await payer.verify?.(
        body.request as never,
        body.determination as never
      )
    });
  }

  return json({ error: { reason: "not-found", path: url.pathname } }, 404);
};

Bun.serve({
  hostname: "0.0.0.0",
  port,
  fetch: (request) => routes(request).catch(errorResponse)
});

console.log(`x278 reference payer listening on http://0.0.0.0:${port}`);
