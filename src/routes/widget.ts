import { Router } from 'express'
import type { SupabaseClient } from '@supabase/supabase-js'

import { TtlCache } from '../lib/cache.js'
import { asyncHandler, AppError } from '../lib/errors.js'
import { respondValidationError } from '../lib/http.js'
import { widgetConfigQuerySchema } from '../schemas/api.js'
import { createSignedStorageUrl, LOGO_BUCKET } from '../services/storageService.js'
import { loadChatbotByPublicKey } from '../services/tenantService.js'

type WidgetRouterOptions = {
  supabaseAdminClient: SupabaseClient
  frontendUrl: string
  backendBaseUrl: string
  defaultWidgetLogoPath?: string
  defaultWidgetLogoUrl?: string
}

type WidgetConfigResponse = {
  ok: true
  config: {
    chatbot_id: string
    client_id: string | null
    widget_public_key: string
    name: string
    business_name: string
    theme: 'dark'
    greeting: string
    primary_color: string
    logo_url: string
    allowed_domains: string[]
  }
}

const WIDGET_CONFIG_CACHE_TTL_MS = 2 * 60 * 1000
const WIDGET_SCRIPT_CACHE_TTL_MS = 5 * 60 * 1000

const widgetConfigCache = new TtlCache<string, WidgetConfigResponse>({
  defaultTtlMs: WIDGET_CONFIG_CACHE_TTL_MS,
})
const widgetScriptCache = new TtlCache<string, string>({
  defaultTtlMs: WIDGET_SCRIPT_CACHE_TTL_MS,
})

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function getSafeDomainList(chatbot: {
  allowed_domains?: string[]
  website_url?: string | null
}): string[] {
  const explicit = Array.isArray(chatbot.allowed_domains) ? chatbot.allowed_domains : []
  if (explicit.length > 0) {
    return explicit
  }

  if (!chatbot.website_url) {
    return []
  }

  try {
    return [new URL(chatbot.website_url).hostname.toLowerCase()]
  } catch {
    return []
  }
}

async function safeCreateSignedStorageUrl(args: {
  supabaseAdminClient: SupabaseClient
  bucket: string
  storagePath: string | null | undefined
  expiresInSeconds?: number
}): Promise<string | null> {
  try {
    return await createSignedStorageUrl(args)
  } catch {
    return null
  }
}

async function resolveWidgetLogoUrl(args: {
  supabaseAdminClient: SupabaseClient
  chatbotLogoPath: string | null
  defaultLogoPath?: string
  defaultLogoUrl?: string
  frontendUrl: string
}): Promise<string> {
  const customLogoUrl = await safeCreateSignedStorageUrl({
    supabaseAdminClient: args.supabaseAdminClient,
    bucket: LOGO_BUCKET,
    storagePath: args.chatbotLogoPath,
    expiresInSeconds: 3600,
  })
  if (customLogoUrl) {
    return customLogoUrl
  }

  const normalizedDefaultPath = args.defaultLogoPath?.trim()
  if (normalizedDefaultPath) {
    const defaultSignedLogoUrl = await safeCreateSignedStorageUrl({
      supabaseAdminClient: args.supabaseAdminClient,
      bucket: LOGO_BUCKET,
      storagePath: normalizedDefaultPath,
      expiresInSeconds: 3600,
    })

    if (defaultSignedLogoUrl) {
      return defaultSignedLogoUrl
    }
  }

  const normalizedDefaultUrl = args.defaultLogoUrl?.trim()
  if (normalizedDefaultUrl) {
    return normalizedDefaultUrl
  }

  return `${trimTrailingSlash(args.frontendUrl)}/favicon-32x32.png`
}

async function buildWidgetConfigResponse(options: WidgetRouterOptions, key: string): Promise<WidgetConfigResponse> {
  const chatbot = await loadChatbotByPublicKey(options.supabaseAdminClient, key)
  if (!chatbot || !chatbot.is_active) {
    throw new AppError('Widget key not found or inactive', 404)
  }

  const { data: chatbotSettings, error: chatbotSettingsError } = await options.supabaseAdminClient
    .from('chatbot_settings')
    .select('bot_name, greeting_message, primary_color')
    .eq('chatbot_id', chatbot.id)
    .maybeSingle<{ bot_name: string; greeting_message: string; primary_color: string }>()

  if (chatbotSettingsError) {
    throw new AppError('Failed to load chatbot settings for widget', 500, chatbotSettingsError)
  }

  const botName = chatbotSettings?.bot_name?.trim() || chatbot.name
  const greetingMessage =
    chatbotSettings?.greeting_message?.trim() ||
    `Hi, welcome to ${botName}. How can we help you today?`
  const primaryColor = chatbotSettings?.primary_color?.trim() || '#6366f1'

  const logoUrl = await resolveWidgetLogoUrl({
    supabaseAdminClient: options.supabaseAdminClient,
    chatbotLogoPath: chatbot.logo_path,
    defaultLogoPath: options.defaultWidgetLogoPath,
    defaultLogoUrl: options.defaultWidgetLogoUrl,
    frontendUrl: options.frontendUrl,
  })

  return {
    ok: true,
    config: {
      chatbot_id: chatbot.id,
      client_id: chatbot.client_id,
      widget_public_key: chatbot.widget_public_key,
      name: botName,
      business_name: botName,
      theme: 'dark',
      greeting: greetingMessage,
      primary_color: primaryColor,
      logo_url: logoUrl,
      allowed_domains: getSafeDomainList(chatbot),
    },
  }
}

async function buildWidgetScript(options: WidgetRouterOptions, key: string): Promise<string> {
  const chatbot = await loadChatbotByPublicKey(options.supabaseAdminClient, key)
  if (!chatbot || !chatbot.is_active) {
    throw new AppError('Widget key not found or inactive', 404)
  }

  const frontendBase = trimTrailingSlash(options.frontendUrl)
  const backendBase = trimTrailingSlash(options.backendBaseUrl)
  const encodedKey = encodeURIComponent(key)
  const iframeSource = `${frontendBase}/widget?key=${encodedKey}`

  const bubbleLogoUrl = await resolveWidgetLogoUrl({
    supabaseAdminClient: options.supabaseAdminClient,
    chatbotLogoPath: chatbot.logo_path,
    defaultLogoPath: options.defaultWidgetLogoPath,
    defaultLogoUrl: options.defaultWidgetLogoUrl,
    frontendUrl: options.frontendUrl,
  })

  return `(function(){
  if (window.__kufuWidgetLoaded) return;
  window.__kufuWidgetLoaded = true;

  function init() {
  var iframe = document.createElement('iframe');
  iframe.src = '${iframeSource}';
  iframe.style.position = 'fixed';
  iframe.style.bottom = '24px';
  iframe.style.right = '24px';
  iframe.style.width = '380px';
  iframe.style.maxWidth = 'calc(100vw - 32px)';
  iframe.style.height = '620px';
  iframe.style.maxHeight = 'calc(100vh - 48px)';
  iframe.style.border = '0';
  iframe.style.borderRadius = '16px';
  iframe.style.boxShadow = '0 16px 48px rgba(0,0,0,0.32)';
  iframe.style.zIndex = '999999';
  iframe.setAttribute('allow', 'clipboard-write');
  iframe.setAttribute('title', 'Kufu Chatbot');

  var bubble = document.createElement('button');
  bubble.type = 'button';
  bubble.setAttribute('aria-label', 'Open Kufu chat');
  bubble.style.position = 'fixed';
  bubble.style.bottom = '24px';
  bubble.style.right = '24px';
  bubble.style.width = '56px';
  bubble.style.height = '56px';
  bubble.style.border = '0';
  bubble.style.borderRadius = '9999px';
  bubble.style.background = 'linear-gradient(135deg,#4f46e5,#6366f1)';
  bubble.style.display = 'flex';
  bubble.style.alignItems = 'center';
  bubble.style.justifyContent = 'center';
  bubble.style.padding = '0';
  bubble.style.overflow = 'hidden';
  bubble.style.color = '#fff';
  bubble.style.fontSize = '20px';
  bubble.style.cursor = 'pointer';
  bubble.style.boxShadow = '0 16px 32px rgba(79,70,229,.4)';
  var bubbleLogoUrl = ${JSON.stringify(bubbleLogoUrl)};
  if (bubbleLogoUrl) {
    bubble.style.background = '#0f172a';
    var logoImg = document.createElement('img');
    logoImg.src = bubbleLogoUrl;
    logoImg.alt = 'Chat logo';
    logoImg.style.width = '72%';
    logoImg.style.height = '72%';
    logoImg.style.objectFit = 'contain';
    logoImg.style.pointerEvents = 'none';
    bubble.appendChild(logoImg);
  } else {
    bubble.textContent = 'AI';
  }

  var open = false;
  function sync(){
    iframe.style.display = open ? 'block' : 'none';
    bubble.style.display = open ? 'none' : 'flex';
  }

  bubble.addEventListener('click', function(){
    open = true;
    sync();
  });

  window.addEventListener('message', function(event){
    if (!event || !event.data) return;
    if (event.data.type === 'kufu_widget_close') {
      open = false;
      sync();
    }
    if (event.data.type === 'kufu_widget_logo' && event.data.logoUrl) {
      var newLogoUrl = event.data.logoUrl;
      bubble.style.background = '#0f172a';
      var existingImg = bubble.querySelector('img');
      if (existingImg) {
        existingImg.src = newLogoUrl;
      } else {
        bubble.textContent = '';
        var updatedImg = document.createElement('img');
        updatedImg.src = newLogoUrl;
        updatedImg.alt = 'Chat logo';
        updatedImg.style.width = '72%';
        updatedImg.style.height = '72%';
        updatedImg.style.objectFit = 'contain';
        updatedImg.style.pointerEvents = 'none';
        bubble.appendChild(updatedImg);
      }
    }
  });

  document.body.appendChild(iframe);
  document.body.appendChild(bubble);
  sync();

  console.log('[kufu-widget] loaded', { key: '${encodedKey}', backend: '${backendBase}' });
  } // end init

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();`
}

export function createWidgetApiRouter(options: WidgetRouterOptions): Router {
  const router = Router()

  router.get(
    '/config',
    asyncHandler(async (request, response) => {
      const parsed = widgetConfigQuerySchema.safeParse({
        key: request.query.key,
      })
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const key = parsed.data.key
      const cacheKey = `widget_config:${key}`
      const payload = await widgetConfigCache.getOrSet(cacheKey, () =>
        buildWidgetConfigResponse(options, key),
      )

      response.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120')
      response.json(payload)
    }),
  )

  return router
}

export function createWidgetScriptRouter(options: WidgetRouterOptions): Router {
  const router = Router()

  router.get(
    '/kufu.js',
    asyncHandler(async (request, response) => {
      const parsed = widgetConfigQuerySchema.safeParse({
        key: request.query.key,
      })
      if (!parsed.success) {
        return respondValidationError(parsed.error, response)
      }

      const key = parsed.data.key
      const cacheKey = `widget_script:${key}`
      const script = await widgetScriptCache.getOrSet(cacheKey, () => buildWidgetScript(options, key))

      response.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=300')
      response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
      response.setHeader('Content-Type', 'application/javascript; charset=utf-8')
      response.status(200).send(script)
    }),
  )

  return router
}
