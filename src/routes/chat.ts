import { Router, type Request } from "express";
import type OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getOptionalRequestUser } from "../lib/auth-middleware.js";
import { asyncHandler, AppError } from "../lib/errors.js";
import {
  getClientIp,
  getTimestamp,
  hashIp,
  respondValidationError,
} from "../lib/http.js";
import { logError, logWarn } from "../lib/logger.js";
import { createFixedWindowLimiter } from "../lib/rateLimit.js";
import { getRequestIdFromRequest } from "../lib/requestContext.js";
import { sanitizeMessages } from "../lib/sanitizeMessages.js";
import { buildSystemPrompt } from "../lib/systemPrompt.js";
import type { createMailer } from "../lib/mailer.js";
import { retrieveRelevantChunks } from "../rag/retrieval.js";
import { chatSchema, chatLogSchema } from "../schemas/api.js";
import {
  appendLeadCaptureAcknowledgement,
  estimateTokens,
  loadClientKnowledgeText,
  storeChatMessages,
  upsertLeadFromMessage,
} from "../services/chatService.js";
import {
  enforcePlanMessageLimit,
  incrementSubscriptionUsage,
  type PlanRow,
  type SubscriptionRow,
} from "../services/subscriptionService.js";
import {
  insertChatHistoryRow,
  isFirstLeadCaptureForVisitorSession,
  isFirstVisitorSessionMessage,
} from "../services/chatHistoryService.js";
import {
  notifyClientOnLeadCapture,
  notifyClientOnNewChat,
} from "../services/clientNotificationService.js";
import {
  extractDomainFromRequestOrigin,
  ensureDefaultChatbot,
  loadChatbotByPublicKey,
  loadChatbotById,
  loadClientById,
  loadClientByUserId,
  loadUserById,
} from "../services/tenantService.js";
import type { DataStore } from "../lib/dataStore.js";

type ChatRouterOptions = {
  jwtSecret: string;
  openAiApiKey: string;
  openAiModel: string;
  openAiClient: OpenAI | null;
  supabaseAdminClient: SupabaseClient;
  dataStore: DataStore;
  mailer: ReturnType<typeof createMailer>;
  chatRateLimitPerMinute: number;
};

type ChatContext = {
  mode: "public" | "dashboard" | "widget";
  userId: string | null;
  clientId: string | null;
  chatbotId: string | null;
  chatbotName: string | null;
  userRole: "user" | "admin";
  plan: PlanRow | null;
  subscription: SubscriptionRow | null;
};

function pickSessionId(input: string | undefined): string {
  const trimmed = (input ?? "").trim();
  if (trimmed.length === 0) {
    return `session_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
  return trimmed.slice(0, 120);
}

function findLastUserMessage(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      return messages[index].content;
    }
  }
  return "";
}

function hasAlreadyAskedForLeadInfo(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): boolean {
  return messages.some(
    (msg) =>
      msg.role === "assistant" &&
      /(?:name|contact|email|phone)/i.test(msg.content) &&
      /(?:could i get|can i get|may i get|get your|share your|leave your|provide your)/i.test(msg.content),
  );
}

function extractNameFromConversation(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): string | null {
  // After the bot asked for name+contact, look in subsequent user messages for "my name is X" or "I'm X"
  let botAsked = false
  for (const msg of messages) {
    if (
      msg.role === "assistant" &&
      /(?:name|contact|email|phone)/i.test(msg.content) &&
      /(?:could i get|can i get|may i get|get your|share your|leave your|provide your)/i.test(msg.content)
    ) {
      botAsked = true
      continue
    }
    if (botAsked && msg.role === "user") {
      const nameMatch = msg.content.match(
        /(?:(?:my name is|i(?:'m| am))\s+)([A-Za-z][a-z]+(?:\s+[A-Za-z][a-z]+)*)/i,
      )
      if (nameMatch?.[1]) {
        return nameMatch[1].trim()
      }
      // If the bot asked and user replied with just a name before contact info (e.g. "John, john@email.com")
      const leadingNameMatch = msg.content.match(
        /^([A-Za-z][a-z]+(?:\s+[A-Za-z][a-z]+)*)\s*[,\s]/,
      )
      if (leadingNameMatch?.[1] && leadingNameMatch[1].length >= 2) {
        const candidate = leadingNameMatch[1].trim()
        const SKIP = new Set(['hi', 'hey', 'hello', 'yes', 'no', 'ok', 'okay', 'sure', 'my'])
        if (!SKIP.has(candidate.toLowerCase())) {
          return candidate
        }
      }
    }
  }
  return null
}

function isDomainAllowed(domain: string | null, allowedDomains: string[]): boolean {
  if (!domain) return true
  if (allowedDomains.length === 0) return true

  // Allow requests from your own frontend (widget iframe origin)
  const ownFrontendDomain = process.env.FRONTEND_URL 
    ? new URL(process.env.FRONTEND_URL).hostname.toLowerCase() 
    : null
  
  if (ownFrontendDomain && domain === ownFrontendDomain) return true

  return allowedDomains.some((allowedDomain) => {
    const normalizedAllowed = allowedDomain.toLowerCase()
    return domain === normalizedAllowed || domain.endsWith(`.${normalizedAllowed}`)
  })
}

async function resolveChatContext(
  request: Request,
  body: {
    key?: string;
    widgetKey?: string;
    chatbot_id?: string;
    chatbotId?: string;
    client_id?: string;
    metadata?: {
      key?: string;
      widgetKey?: string;
      chatbot_id?: string;
      chatbotId?: string;
      client_id?: string;
    };
  },
  options: ChatRouterOptions,
): Promise<ChatContext> {
  const authUser = getOptionalRequestUser(request, options.jwtSecret);
  const providedKey =
    body.key ||
    body.widgetKey ||
    body.metadata?.key ||
    body.metadata?.widgetKey ||
    (typeof request.query.key === "string" ? request.query.key : undefined);
  const providedChatbotId =
    body.chatbot_id ||
    body.chatbotId ||
    body.metadata?.chatbot_id ||
    body.metadata?.chatbotId;

  if (authUser) {
    const user = await loadUserById(
      options.supabaseAdminClient,
      authUser.userId,
    );
    if (!user) {
      throw new AppError("Unauthorized", 401);
    }

    let chatbotId = providedChatbotId || null;
    let resolvedClientId: string | null = authUser.clientId;
    let resolvedChatbotName: string | null = null;
    if (chatbotId) {
      const chatbot = await loadChatbotById(
        options.supabaseAdminClient,
        chatbotId,
      );
      if (!chatbot || chatbot.user_id !== user.id) {
        throw new AppError("Chatbot not found", 404);
      }
      resolvedClientId = chatbot.client_id ?? authUser.clientId;
      if (!resolvedClientId) {
        const fallbackClient = await loadClientByUserId(
          options.supabaseAdminClient,
          user.id,
        );
        resolvedClientId = fallbackClient?.id ?? null;
      }
      resolvedChatbotName = chatbot.name;
    }

    if (!chatbotId) {
      const defaultClient = await loadClientByUserId(
        options.supabaseAdminClient,
        user.id,
      );
      if (!defaultClient) {
        throw new AppError("Client profile missing", 500);
      }

      const defaultChatbot = await ensureDefaultChatbot(
        options.supabaseAdminClient,
        {
          userId: user.id,
          clientId: defaultClient.id,
          websiteUrl: defaultClient.website_url,
          businessName: defaultClient.business_name,
        },
      );

      chatbotId = defaultChatbot.id;
      resolvedClientId = defaultClient.id;
      resolvedChatbotName = defaultChatbot.name;
    }

    const usage = await enforcePlanMessageLimit(
      options.supabaseAdminClient,
      user.id,
      user.role,
    );
    if (!usage.allowed) {
      throw new AppError(usage.reason || "Plan usage limit reached", 403);
    }
    return {
      mode: "dashboard",
      userId: user.id,
      clientId: resolvedClientId,
      chatbotId,
      chatbotName: resolvedChatbotName,
      userRole: user.role,
      plan: usage.plan,
      subscription: usage.subscription,
    };
  }

  if (providedKey) {
    const chatbot = await loadChatbotByPublicKey(
      options.supabaseAdminClient,
      providedKey,
    );
    if (!chatbot || !chatbot.is_active) {
      throw new AppError("Invalid widget key", 404);
    }

    const originDomain = extractDomainFromRequestOrigin(
      request.header("origin") ?? null,
    );
    const refererDomain = extractDomainFromRequestOrigin(
      request.header("referer") ?? null,
    );
    const requestDomain = refererDomain || originDomain

    const allowedDomains = Array.isArray(chatbot.allowed_domains)
      ? chatbot.allowed_domains
      : [];

    if (!isDomainAllowed(requestDomain, allowedDomains)) {
      throw new AppError("Widget origin is not allowed", 403);
    }

    const ownerUser = await loadUserById(
      options.supabaseAdminClient,
      chatbot.user_id,
    );
    if (!ownerUser) {
      throw new AppError("Widget owner user not found", 500);
    }

    const usage = await enforcePlanMessageLimit(
      options.supabaseAdminClient,
      ownerUser.id,
      ownerUser.role,
    );
    if (!usage.allowed) {
      throw new AppError(usage.reason || "Plan usage limit reached", 403);
    }

    const fallbackClient = chatbot.client_id
      ? null
      : await loadClientByUserId(options.supabaseAdminClient, ownerUser.id);

    return {
      mode: "widget",
      userId: ownerUser.id,
      clientId: chatbot.client_id ?? fallbackClient?.id ?? null,
      chatbotId: chatbot.id,
      chatbotName: chatbot.name,
      userRole: ownerUser.role,
      plan: usage.plan,
      subscription: usage.subscription,
    };
  }

  return {
    mode: "public",
    userId: null,
    clientId: null,
    chatbotId: null,
    chatbotName: null,
    userRole: "user",
    plan: null,
    subscription: null,
  };
}

export function createChatRouter(options: ChatRouterOptions): Router {
  const router = Router();

  const chatLimiter = createFixedWindowLimiter({
    namespace: "chat",
    windowMs: 60 * 1000,
    max: options.chatRateLimitPerMinute,
    keyGenerator: (request) => {
      const ip = getClientIp(request);
      const sessionFromBody =
        typeof (request.body as { sessionId?: unknown })?.sessionId === "string"
          ? ((request.body as { sessionId?: string }).sessionId ?? "")
          : "";
      const keyFromQuery =
        typeof request.query.key === "string" ? request.query.key : "";
      const keyFromBody =
        typeof (request.body as { key?: unknown })?.key === "string"
          ? ((request.body as { key?: string }).key ?? "")
          : "";
      return `${ip}:${sessionFromBody || keyFromBody || keyFromQuery || "no-key"}`;
    },
    message: "Too many chat requests. Please try again later.",
  });

  router.post(
    "/chat",
    chatLimiter,
    asyncHandler(async (request, response) => {
      const parsed = chatSchema.safeParse(request.body);
      if (!parsed.success) {
        return respondValidationError(parsed.error, response);
      }

      const sanitizedMessages = sanitizeMessages(parsed.data.messages, 12);
      if (sanitizedMessages.length === 0) {
        throw new AppError("No valid messages provided.", 400);
      }

      const sessionId = pickSessionId(parsed.data.sessionId);
      const lastUserMessage = findLastUserMessage(sanitizedMessages);

      if (!lastUserMessage) {
        throw new AppError("At least one user message is required.", 400);
      }

      const context = await resolveChatContext(request, parsed.data, options);

      const shouldUseGlobalKnowledge =
        context.userRole === "admin" &&
        context.mode === "dashboard";

      const baseKnowledge = shouldUseGlobalKnowledge
        ? await options.dataStore.getKnowledgeText()
        : "";

      let clientKnowledge = "";
      let clientBusinessName: string | null = null;
      if (context.clientId) {
        const client = await loadClientById(
          options.supabaseAdminClient,
          context.clientId,
        );
        if (client) {
          clientBusinessName = client.business_name;
          clientKnowledge = await loadClientKnowledgeText(
            options.supabaseAdminClient,
            context.clientId,
            client.knowledge_base_text,
          );
        }
      }

      const mergedKnowledge = [baseKnowledge, clientKnowledge]
        .filter(Boolean)
        .join("\n\n");

      if (!options.openAiApiKey || !options.openAiClient) {
        return response.json({
          ok: true,
          reply: "OPENAI_API_KEY missing on server.",
          usage: context.subscription,
        });
      }

      const ragChunks =
        context.chatbotId && options.openAiClient
          ? await retrieveRelevantChunks({
              supabaseAdminClient: options.supabaseAdminClient,
              openAiClient: options.openAiClient,
              chatbotId: context.chatbotId,
              queryText: lastUserMessage,
              topK: 8,
            })
          : [];

      const ragContext = ragChunks
        .map(
          (chunk, index) =>
            `Source ${index + 1}: ${chunk.url}\n${chunk.chunkText}`,
        )
        .join("\n\n");

      const strictContextInstruction = [
        "You are a business assistant.",
        "Use only the provided context to answer.",
        "If the answer is not in the context, say you don't know and suggest contacting the business directly.",
        "Do not fabricate facts or policies.",
      ].join(" ");

      let assistantName = context.chatbotName?.trim() || "AI Assistant";
      if (context.chatbotId) {
        const { data: chatbotSettings, error: chatbotSettingsError } =
          await options.supabaseAdminClient
            .from("chatbot_settings")
            .select("bot_name")
            .eq("chatbot_id", context.chatbotId)
            .maybeSingle<{ bot_name: string }>();

        if (chatbotSettingsError) {
          throw new AppError(
            "Failed to load chatbot settings for response prompt",
            500,
            chatbotSettingsError,
          );
        }

        const configuredBotName = chatbotSettings?.bot_name?.trim();
        if (configuredBotName) {
          assistantName = configuredBotName;
        }
      }

      const effectiveBusinessName =
        context.mode === 'widget' ? assistantName : clientBusinessName

      const alreadyAskedForLeadInfo = hasAlreadyAskedForLeadInfo(sanitizedMessages)
      const leadCaptureInstruction = alreadyAskedForLeadInfo
        ? "Lead capture: You have already asked the visitor for their contact details in this conversation. Do NOT ask again."
        : "Lead capture: If the visitor shows buying intent (asks about pricing, services, booking, plans, or wants to proceed), ask once for their name and either an email address or phone number so the team can follow up. Example: \"To connect you with our team, could I get your name and a contact email or phone number?\" Ask this at most once."

      const systemPrompt = [
        strictContextInstruction,
        buildSystemPrompt(mergedKnowledge, {
          assistantName,
          businessName: effectiveBusinessName,
        }),
        leadCaptureInstruction,
        ragContext
          ? `Website Context:\n${ragContext}`
          : "Website Context:\nNo relevant website context was retrieved.",
      ].join("\n\n");

      const completion = await options.openAiClient.chat.completions.create({
        model: options.openAiModel,
        messages: [
          { role: "system", content: systemPrompt },
          ...sanitizedMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        ],
        temperature: 0.4,
      });

      const aiReply =
        completion.choices?.[0]?.message?.content?.trim() ||
        "Sorry - I couldn't generate a response.";

      const conversationName = extractNameFromConversation(sanitizedMessages)

      let leadCaptured = false;
      let capturedLeadEmail: string | null = null;
      let capturedLeadPhone: string | null = null;
      let capturedLeadText: string | null = null;
      let capturedLeadName: string | null = null;
      if (context.clientId) {
        const leadCaptureResult = await upsertLeadFromMessage(
          options.supabaseAdminClient,
          {
            clientId: context.clientId,
            content: lastUserMessage,
            sessionId,
            name: conversationName,
          },
        );
        leadCaptured = leadCaptureResult.captured;
        capturedLeadName = leadCaptureResult.name;
        capturedLeadEmail = leadCaptureResult.email;
        capturedLeadPhone = leadCaptureResult.phone;
        capturedLeadText = leadCaptureResult.leadText;
      } else if (context.mode !== "public") {
        logWarn({
          type: "lead_capture_skipped_missing_client",
          requestId: getRequestIdFromRequest(request),
          path: "/api/chat",
          mode: context.mode,
          chatbotId: context.chatbotId,
          userId: context.userId,
        });
      }

      const reply = appendLeadCaptureAcknowledgement(aiReply, leadCaptured);

      if (context.userId && context.chatbotId) {
        await storeChatMessages({
          supabaseAdminClient: options.supabaseAdminClient,
          userId: context.userId,
          chatbotId: context.chatbotId,
          sessionId,
          userMessage: lastUserMessage,
          assistantMessage: reply,
        });
      }

      if (
        context.userId &&
        context.userRole !== "admin" &&
        context.subscription
      ) {
        const updatedSubscription = await incrementSubscriptionUsage(
          options.supabaseAdminClient,
          context.subscription,
          1,
        );
        context.subscription = updatedSubscription;
      }

      if (context.mode === "widget" && context.chatbotId) {
        const shouldNotifyNewChat = await isFirstVisitorSessionMessage({
          supabaseAdminClient: options.supabaseAdminClient,
          chatbotId: context.chatbotId,
          visitorId: sessionId,
        });

        const shouldNotifyLeadCapture =
          leadCaptured
            ? await isFirstLeadCaptureForVisitorSession({
                supabaseAdminClient: options.supabaseAdminClient,
                chatbotId: context.chatbotId,
                visitorId: sessionId,
              })
            : false;

        await insertChatHistoryRow({
          supabaseAdminClient: options.supabaseAdminClient,
          chatbotId: context.chatbotId,
          visitorId: sessionId,
          userMessage: lastUserMessage,
          botResponse: reply,
          leadCaptured,
        });

        if (shouldNotifyNewChat) {
          try {
            await notifyClientOnNewChat({
              supabaseAdminClient: options.supabaseAdminClient,
              mailer: options.mailer,
              chatbotId: context.chatbotId,
              visitorId: sessionId,
              userMessage: lastUserMessage,
            });
          } catch (notificationError) {
            logError({
              type: "new_chat_notification_failed",
              requestId: getRequestIdFromRequest(request),
              path: "/api/chat",
              chatbotId: context.chatbotId,
              message:
                notificationError instanceof Error
                  ? notificationError.message
                  : "Unknown notification error",
            });
          }
        }

        if (leadCaptured && shouldNotifyLeadCapture) {
          try {
            await notifyClientOnLeadCapture({
              supabaseAdminClient: options.supabaseAdminClient,
              mailer: options.mailer,
              chatbotId: context.chatbotId,
              visitorId: sessionId,
              userMessage: lastUserMessage,
              leadName: capturedLeadName,
              leadEmail: capturedLeadEmail,
              leadPhone: capturedLeadPhone,
              leadText: capturedLeadText,
            });
          } catch (notificationError) {
            logError({
              type: "lead_capture_notification_failed",
              requestId: getRequestIdFromRequest(request),
              path: "/api/chat",
              chatbotId: context.chatbotId,
              message:
                notificationError instanceof Error
                  ? notificationError.message
                  : "Unknown notification error",
            });
          }
        }
      }

      await options.dataStore.appendJsonLine("chats_ai.jsonl", {
        ts: getTimestamp(),
        ipHash: hashIp(getClientIp(request)),
        sessionId,
        page: parsed.data.metadata?.page ?? null,
        mode: context.mode,
        userId: context.userId,
        clientId: context.clientId,
        chatbotId: context.chatbotId,
        model: options.openAiModel,
        usageMessageEstimate:
          estimateTokens(lastUserMessage) + estimateTokens(reply),
      });

      response.json({
        ok: true,
        reply,
        mode: context.mode,
        subscription: context.subscription,
        plan: context.plan,
      });
    }),
  );

  router.post(
    "/chat/log",
    asyncHandler(async (request, response) => {
      const parsed = chatLogSchema.safeParse(request.body);
      if (!parsed.success) {
        return respondValidationError(parsed.error, response);
      }

      await options.dataStore.appendJsonLine("chats.jsonl", {
        ts: getTimestamp(),
        ...parsed.data,
      });

      response.json({ ok: true });
    }),
  );

  return router;
}
