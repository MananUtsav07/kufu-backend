import { Router } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';

import { authMiddleware, type AuthenticatedRequest } from '../lib/auth-middleware.js';
import { asyncHandler, AppError } from '../lib/errors.js';
import { respondValidationError } from '../lib/http.js';
import {
  siteDetectionDetectSchema,
  siteDetectionInstallGuideQuerySchema,
} from '../schemas/siteDetection.js';
import { buildWidgetEmbedSnippet } from '../services/embedSnippetService.js';
import {
  detectWebsiteTypeFromUrl,
  normalizeWebsiteUrl,
} from '../services/siteDetection/detectWebsiteType.js';
import { buildInstallGuide } from '../services/siteDetection/installGuide.js';
import { loadChatbotById } from '../services/tenantService.js';

type SiteDetectionRouterOptions = {
  jwtSecret: string;
  supabaseAdminClient: SupabaseClient;
  backendBaseUrl: string;
};

type WebsiteIntegrationRow = {
  id: string;
};

function asAuthenticatedRequest(request: unknown): AuthenticatedRequest {
  return request as AuthenticatedRequest;
}

async function loadOwnedChatbot(args: {
  supabaseAdminClient: SupabaseClient;
  chatbotId: string;
  userId: string;
  role: 'user' | 'admin';
}) {
  const chatbot = await loadChatbotById(args.supabaseAdminClient, args.chatbotId);
  const isOwner = chatbot?.user_id === args.userId;
  const canAccess = args.role === 'admin' || isOwner;

  if (!chatbot || !canAccess) {
    throw new AppError('Chatbot not found', 404);
  }

  return chatbot;
}

async function storeDetectionResult(args: {
  supabaseAdminClient: SupabaseClient;
  userId: string;
  chatbotId: string | null;
  websiteUrl: string;
  detectedType: string;
  detectionConfidence: string;
  detectionSignals: string[];
}) {
  const detectedAt = new Date().toISOString();

  if (!args.chatbotId) {
    const { error } = await args.supabaseAdminClient
      .from('website_integrations')
      .insert({
        user_id: args.userId,
        chatbot_id: null,
        website_url: args.websiteUrl,
        detected_type: args.detectedType,
        detection_confidence: args.detectionConfidence,
        detection_signals: args.detectionSignals,
        last_detected_at: detectedAt,
        updated_at: detectedAt,
      });

    if (error) {
      throw new AppError('Failed to store site detection result', 500, error);
    }

    return;
  }

  const { data: existing, error: existingError } = await args.supabaseAdminClient
    .from('website_integrations')
    .select('id')
    .eq('user_id', args.userId)
    .eq('chatbot_id', args.chatbotId)
    .maybeSingle<WebsiteIntegrationRow>();

  if (existingError) {
    throw new AppError('Failed to load existing site detection result', 500, existingError);
  }

  if (existing?.id) {
    const { error } = await args.supabaseAdminClient
      .from('website_integrations')
      .update({
        website_url: args.websiteUrl,
        detected_type: args.detectedType,
        detection_confidence: args.detectionConfidence,
        detection_signals: args.detectionSignals,
        last_detected_at: detectedAt,
        updated_at: detectedAt,
      })
      .eq('id', existing.id);

    if (error) {
      throw new AppError('Failed to update site detection result', 500, error);
    }

    return;
  }

  const { error } = await args.supabaseAdminClient
    .from('website_integrations')
    .insert({
      user_id: args.userId,
      chatbot_id: args.chatbotId,
      website_url: args.websiteUrl,
      detected_type: args.detectedType,
      detection_confidence: args.detectionConfidence,
      detection_signals: args.detectionSignals,
      last_detected_at: detectedAt,
      updated_at: detectedAt,
    });

  if (error) {
    throw new AppError('Failed to store site detection result', 500, error);
  }
}

export function createSiteDetectionRouter(
  options: SiteDetectionRouterOptions,
): Router {
  const router = Router();

  router.use(authMiddleware(options.jwtSecret));

  router.post(
    '/detect',
    asyncHandler(async (request, response) => {
      const parsed = siteDetectionDetectSchema.safeParse(request.body);
      if (!parsed.success) {
        return respondValidationError(parsed.error, response);
      }

      const authRequest = asAuthenticatedRequest(request);
      const chatbotId = parsed.data.chatbotId ?? null;

      if (chatbotId) {
        await loadOwnedChatbot({
          supabaseAdminClient: options.supabaseAdminClient,
          chatbotId,
          userId: authRequest.user.userId,
          role: authRequest.user.role,
        });
      }

      const websiteUrl = normalizeWebsiteUrl(parsed.data.websiteUrl);
      const detection = await detectWebsiteTypeFromUrl(websiteUrl);

      await storeDetectionResult({
        supabaseAdminClient: options.supabaseAdminClient,
        userId: authRequest.user.userId,
        chatbotId,
        websiteUrl,
        detectedType: detection.websiteType,
        detectionConfidence: detection.confidence,
        detectionSignals: detection.signals,
      });

      response.json({
        ok: true,
        websiteType: detection.websiteType,
        confidence: detection.confidence,
        signals: detection.signals,
      });
    }),
  );

  router.get(
    '/install-guide',
    asyncHandler(async (request, response) => {
      const parsed = siteDetectionInstallGuideQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return respondValidationError(parsed.error, response);
      }

      const authRequest = asAuthenticatedRequest(request);
      const chatbotId = parsed.data.chatbotId ?? null;

      let widgetPublicKey = 'YOUR_WIDGET_PUBLIC_KEY';
      if (chatbotId) {
        const chatbot = await loadOwnedChatbot({
          supabaseAdminClient: options.supabaseAdminClient,
          chatbotId,
          userId: authRequest.user.userId,
          role: authRequest.user.role,
        });

        widgetPublicKey = chatbot.widget_public_key;
      }

      const scriptExample = buildWidgetEmbedSnippet({
        backendBaseUrl: options.backendBaseUrl,
        widgetPublicKey,
      });

      const guide = buildInstallGuide({
        websiteType: parsed.data.websiteType,
        scriptExample,
      });

      response.json({
        ok: true,
        title: guide.title,
        steps: guide.steps,
        scriptExample: guide.scriptExample,
      });
    }),
  );

  return router;
}
