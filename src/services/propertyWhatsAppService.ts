export type TenantWhatsAppSupportStub = {
  ownerId: string
  tenantId: string
  supportWhatsApp: string | null
  messageTemplate: string
}

export function buildTenantWhatsAppSupportStub(args: {
  ownerId: string
  tenantId: string
  supportWhatsApp: string | null
}): TenantWhatsAppSupportStub {
  return {
    ownerId: args.ownerId,
    tenantId: args.tenantId,
    supportWhatsApp: args.supportWhatsApp,
    messageTemplate:
      'Hi, I need help with my property account. Please assist when available.',
  }
}
