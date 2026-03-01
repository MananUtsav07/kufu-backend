import { Router } from "express";
import type OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";

import { demoLeadSchema, contactLeadSchema } from "../schemas/api.js";
import { getTimestamp, respondValidationError } from "../lib/http.js";
import type { DataStore } from "../lib/dataStore.js";
import { createMailer } from "../lib/mailer.js";
import { createAdminRouter } from "./admin.js";
import { createAuthRouter } from "./auth.js";
import { createChatRouter } from "./chat.js";
import { createDashboardRouter } from "./dashboard.js";
import { createRagRouter } from "./rag.js";
import { createWidgetApiRouter } from "./widget.js";

type ApiRouterOptions = {
  nodeEnv: string;
  isProduction: boolean;
  appBaseUrl: string;
  backendBaseUrl: string;
  frontendUrl: string;
  openAiApiKey: string;
  openAiModel: string;
  openAiClient: OpenAI | null;
  supabaseAdminClient: SupabaseClient | null;
  jwtSecret: string;
  brevoApiKey: string;
  contactLeadNotifyEmail: string;
  demoLeadNotifyEmail: string;
  emailFrom: string;
  dataStore: DataStore;
  allowDevBypassEmailVerify: boolean;
};

export function createApiRouter(options: ApiRouterOptions): Router {
  const router = Router();

  router.get("/health", (_request, response) => {
    response.json({
      ok: true,
      env: options.nodeEnv,
      openaiKeyPresent: Boolean(options.openAiApiKey),
    });
  });

  if (!options.supabaseAdminClient) {
    router.use((_request, response) => {
      response.status(500).json({
        ok: false,
        error:
          "Server configuration missing: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      });
    });
    return router;
  }

 const mailer = createMailer({
  brevoApiKey: options.brevoApiKey,
  emailFrom: options.emailFrom,
})

  router.use(
    "/auth",
    createAuthRouter({
      isProduction: options.isProduction,
      appBaseUrl: options.appBaseUrl,
      backendBaseUrl: options.backendBaseUrl,
      jwtSecret: options.jwtSecret,
      supabaseAdminClient: options.supabaseAdminClient,
      mailer,
      allowDevBypassEmailVerify: options.allowDevBypassEmailVerify,
    }),
  );

  router.use(
    "/dashboard",
    createDashboardRouter({
      jwtSecret: options.jwtSecret,
      supabaseAdminClient: options.supabaseAdminClient,
      backendBaseUrl: options.backendBaseUrl,
    }),
  );

  router.use(
    "/admin",
    createAdminRouter({
      jwtSecret: options.jwtSecret,
      supabaseAdminClient: options.supabaseAdminClient,
    }),
  );

  router.use(
    "/widget",
    createWidgetApiRouter({
      supabaseAdminClient: options.supabaseAdminClient,
      frontendUrl: options.frontendUrl,
      backendBaseUrl: options.backendBaseUrl,
    }),
  );

  router.use(
    "/rag",
    createRagRouter({
      jwtSecret: options.jwtSecret,
      supabaseAdminClient: options.supabaseAdminClient,
      openAiClient: options.openAiClient,
    }),
  );

  router.use(
    "/",
    createChatRouter({
      jwtSecret: options.jwtSecret,
      openAiApiKey: options.openAiApiKey,
      openAiModel: options.openAiModel,
      openAiClient: options.openAiClient,
      supabaseAdminClient: options.supabaseAdminClient,
      dataStore: options.dataStore,
    }),
  );

  router.post("/leads/demo", async (request, response, next) => {
    try {
      const parsed = demoLeadSchema.safeParse(request.body);
      if (!parsed.success) {
        return respondValidationError(parsed.error, response);
      }

      await options.dataStore.appendJsonLine("leads_demo.jsonl", {
        ts: getTimestamp(),
        ...parsed.data,
      });

      if (mailer) {
        try {
          await mailer.sendDemoLeadNotification({
            to: options.demoLeadNotifyEmail,
            submittedAtIso: new Date().toISOString(),
            fullName: parsed.data.fullName,
            businessType: parsed.data.businessType,
            websiteUrl: parsed.data.websiteUrl,
            phone: parsed.data.phone,
            email: parsed.data.email,
            message: parsed.data.message,
          })
        } catch (mailError) {
          console.error(
            JSON.stringify({
              level: 'error',
              type: 'lead_email_send_failed',
              path: '/api/leads/demo',
              message: mailError instanceof Error ? mailError.message : 'Unknown lead email error',
            }),
          )
        }
      }

      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/leads/contact", async (request, response, next) => {
    try {
      const parsed = contactLeadSchema.safeParse(request.body);
      if (!parsed.success) {
        return respondValidationError(parsed.error, response);
      }

      await options.dataStore.appendJsonLine("leads_contact.jsonl", {
        ts: getTimestamp(),
        ...parsed.data,
      });

      if (mailer) {
        try {
          await mailer.sendContactLeadNotification({
            to: options.contactLeadNotifyEmail,
            submittedAtIso: new Date().toISOString(),
            firstName: parsed.data.firstName,
            lastName: parsed.data.lastName,
            email: parsed.data.email,
            message: parsed.data.message,
          })
        } catch (mailError) {
          console.error(
            JSON.stringify({
              level: 'error',
              type: 'contact_email_send_failed',
              path: '/api/leads/contact',
              message: mailError instanceof Error ? mailError.message : 'Unknown contact email error',
            }),
          )
        }
      }

      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.use((_request, response) => {
    response.status(404).json({
      ok: false,
      error: "API route not found",
    });
  });

  return router;
}
