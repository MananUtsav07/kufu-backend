import type { NextFunction, Request, Response } from 'express'
import type { SupabaseClient } from '@supabase/supabase-js'

import { AppError } from './errors.js'
import { readAuthToken } from './auth-middleware.js'
import { verifyTenantSessionToken, type TenantSessionClaims } from './tenant-session.js'
import { loadTenantSessionByToken } from '../services/propertyManagementService.js'

export type TenantSessionUser = {
  tenantId: string
  ownerId: string
  sessionId: string
}

export type TenantAuthenticatedRequest = Request & {
  tenantUser: TenantSessionUser
}

function isTenantTokenExpired(claims: TenantSessionClaims): boolean {
  if (!claims.exp) {
    return false
  }
  return claims.exp * 1000 < Date.now()
}

export function tenantAuthMiddleware(jwtSecret: string, supabaseAdminClient: SupabaseClient) {
  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      const token = readAuthToken(request)
      if (!token) {
        response.status(401).json({
          ok: false,
          error: 'Tenant session required',
        })
        return
      }

      const claims = verifyTenantSessionToken(token, jwtSecret)
      if (!claims || isTenantTokenExpired(claims)) {
        response.status(401).json({
          ok: false,
          error: 'Invalid tenant session',
        })
        return
      }

      const storedSession = await loadTenantSessionByToken(supabaseAdminClient, token)
      if (!storedSession || storedSession.tenant_id !== claims.sub) {
        response.status(401).json({
          ok: false,
          error: 'Tenant session not found',
        })
        return
      }

      if (new Date(storedSession.expires_at).getTime() < Date.now()) {
        response.status(401).json({
          ok: false,
          error: 'Tenant session expired',
        })
        return
      }

      ;(request as TenantAuthenticatedRequest).tenantUser = {
        tenantId: claims.sub,
        ownerId: claims.owner_id,
        sessionId: claims.session_id,
      }

      next()
    } catch (error) {
      next(new AppError(error instanceof Error ? error.message : 'Tenant authentication failed', 401))
    }
  }
}
