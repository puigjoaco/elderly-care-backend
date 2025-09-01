import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { supabase } from '../../../database/supabase';
import { logger } from '../../../utils/logger';
import { ApiError } from '../../../utils/ApiError';
import { redis } from '../../../cache/redis';

interface ApiKey {
  id: string;
  key: string;
  organizationId: string;
  organizationName: string;
  permissions: string[];
  rateLimit: number;
  status: string;
  expiresAt?: Date;
}

export async function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const apiKey = req.headers['x-api-key'] as string;
    
    if (!apiKey) {
      throw new ApiError(401, 'API key required');
    }
    
    // Check cache first
    const cacheKey = `api_key:${hashApiKey(apiKey)}`;
    const cached = await redis.get(cacheKey);
    
    if (cached) {
      const apiKeyData = JSON.parse(cached) as ApiKey;
      
      if (apiKeyData.status !== 'active') {
        throw new ApiError(403, 'API key is not active');
      }
      
      if (apiKeyData.expiresAt && new Date(apiKeyData.expiresAt) < new Date()) {
        throw new ApiError(403, 'API key has expired');
      }
      
      req.apiKey = apiKeyData;
      
      // Track usage
      await trackApiKeyUsage(apiKeyData.id, req);
      
      next();
      return;
    }
    
    // Validate API key from database
    const hashedKey = hashApiKey(apiKey);
    
    const { data: keyData, error } = await supabase
      .from('api_keys')
      .select(`
        id,
        organization_id,
        permissions,
        rate_limit,
        status,
        expires_at,
        organizations (
          id,
          name,
          status
        )
      `)
      .eq('key_hash', hashedKey)
      .single();
    
    if (error || !keyData) {
      logger.warn('Invalid API key attempt', {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      throw new ApiError(401, 'Invalid API key');
    }
    
    if (keyData.status !== 'active') {
      throw new ApiError(403, 'API key is not active');
    }
    
    if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
      throw new ApiError(403, 'API key has expired');
    }
    
    if (keyData.organizations.status !== 'active') {
      throw new ApiError(403, 'Organization is not active');
    }
    
    // Check rate limiting
    const rateLimitKey = `rate_limit:${keyData.id}`;
    const currentCount = await redis.incr(rateLimitKey);
    
    if (currentCount === 1) {
      await redis.expire(rateLimitKey, 3600); // 1 hour window
    }
    
    if (currentCount > keyData.rate_limit) {
      throw new ApiError(429, 'Rate limit exceeded');
    }
    
    // Prepare API key data
    const apiKeyData: ApiKey = {
      id: keyData.id,
      key: apiKey,
      organizationId: keyData.organization_id,
      organizationName: keyData.organizations.name,
      permissions: keyData.permissions,
      rateLimit: keyData.rate_limit,
      status: keyData.status,
      expiresAt: keyData.expires_at ? new Date(keyData.expires_at) : undefined,
    };
    
    // Cache for 5 minutes
    await redis.setex(cacheKey, 300, JSON.stringify(apiKeyData));
    
    // Attach to request
    req.apiKey = apiKeyData;
    
    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', keyData.rate_limit.toString());
    res.setHeader('X-RateLimit-Remaining', (keyData.rate_limit - currentCount).toString());
    res.setHeader('X-RateLimit-Reset', new Date(Date.now() + 3600000).toISOString());
    
    // Track usage
    await trackApiKeyUsage(keyData.id, req);
    
    // Log API access
    logger.info('API key authenticated', {
      organizationId: keyData.organization_id,
      organizationName: keyData.organizations.name,
      path: req.path,
      method: req.method,
    });
    
    next();
  } catch (error) {
    next(error);
  }
}

function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

async function trackApiKeyUsage(apiKeyId: string, req: Request): Promise<void> {
  try {
    await supabase.from('api_key_usage').insert({
      api_key_id: apiKeyId,
      endpoint: req.path,
      method: req.method,
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      request_body_size: JSON.stringify(req.body || {}).length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to track API key usage', { error, apiKeyId });
  }
}

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.apiKey) {
      next(new ApiError(401, 'API key authentication required'));
      return;
    }
    
    if (!req.apiKey.permissions.includes(permission) && !req.apiKey.permissions.includes('*')) {
      next(new ApiError(403, `Missing required permission: ${permission}`));
      return;
    }
    
    next();
  };
}