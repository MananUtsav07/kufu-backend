import { z } from 'zod';

export const websiteTypeSchema = z.enum([
  'wordpress',
  'shopify',
  'react',
  'nextjs',
  'webflow',
  'wix',
  'squarespace',
  'custom',
  'unknown',
]);

export const detectionConfidenceSchema = z.enum(['high', 'medium', 'low']);

export const siteDetectionDetectSchema = z
  .object({
    websiteUrl: z.string().trim().url(),
    chatbotId: z.string().uuid().optional(),
  })
  .strict();

export const siteDetectionInstallGuideQuerySchema = z
  .object({
    websiteType: websiteTypeSchema,
    chatbotId: z.string().uuid().optional(),
  })
  .strict();
