import { Router } from 'express'
import type { SupabaseClient } from '@supabase/supabase-js'

import { asyncHandler, AppError } from '../lib/errors.js'
import { respondValidationError } from '../lib/http.js'
import { widgetConfigQuerySchema } from '../schemas/api.js'
import { loadChatbotByPublicKey, loadClientById } from '../services/tenantService.js'

type WidgetRouterOptions = {
  supabaseAdminClient: SupabaseClient
  frontendUrl: string
  backendBaseUrl: string
}

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

      const chatbot = await loadChatbotByPublicKey(options.supabaseAdminClient, parsed.data.key)
      if (!chatbot || !chatbot.is_active) {
        throw new AppError('Widget key not found or inactive', 404)
      }

      const client = chatbot.client_id
        ? await loadClientById(options.supabaseAdminClient, chatbot.client_id)
        : null

      response.json({
        ok: true,
        config: {
          chatbot_id: chatbot.id,
          client_id: chatbot.client_id,
          widget_public_key: chatbot.widget_public_key,
          name: chatbot.name,
          business_name: client?.business_name ?? 'Kufu',
          theme: 'dark',
          greeting: `Hi, welcome to ${client?.business_name ?? 'Kufu'}. How can we help you today?`,
          allowed_domains: getSafeDomainList(chatbot),
        },
      })
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

      const chatbot = await loadChatbotByPublicKey(options.supabaseAdminClient, parsed.data.key)
      if (!chatbot || !chatbot.is_active) {
        throw new AppError('Widget key not found or inactive', 404)
      }

      const frontendBase = trimTrailingSlash(options.frontendUrl)
      const backendBase = trimTrailingSlash(options.backendBaseUrl)
      const key = encodeURIComponent(parsed.data.key)
      const iframeSource = `${frontendBase}/widget?key=${key}`

      const script = `(function(){
  if (window.__kufuWidgetLoaded) return;
  window.__kufuWidgetLoaded = true;

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
  bubble.style.color = '#fff';
  bubble.style.fontSize = '20px';
  bubble.style.cursor = 'pointer';
  bubble.style.boxShadow = '0 16px 32px rgba(79,70,229,.4)';
  bubble.textContent = 'AI';

  var open = false;
  function sync(){
    iframe.style.display = open ? 'block' : 'none';
    bubble.style.display = open ? 'none' : 'block';
  }

  bubble.addEventListener('click', function(){
    open = true;
    sync();
  });

  window.addEventListener('message', function(event){
    if (event && event.data && event.data.type === 'kufu_widget_close') {
      open = false;
      sync();
    }
  });

  document.body.appendChild(iframe);
  document.body.appendChild(bubble);
  sync();

  console.log('[kufu-widget] loaded', { key: '${key}', backend: '${backendBase}' });
})();`

      response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
      response.setHeader('Content-Type', 'application/javascript; charset=utf-8')
      response.status(200).send(script)
    }),
  )

  return router
}
