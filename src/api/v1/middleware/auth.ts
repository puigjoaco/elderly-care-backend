import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { supabase } from '../../../database/supabase';
import { logger } from '../../../utils/logger';
import { ApiError } from '../../../utils/ApiError';

interface JWTPayload {
  sub: string;
  email: string;
  role: string;
  iat: number;
  exp: number;
}

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      throw new ApiError(401, 'No authorization header provided');
    }
    
    const [bearer, token] = authHeader.split(' ');
    
    if (bearer !== 'Bearer' || !token) {
      throw new ApiError(401, 'Invalid authorization header format');
    }
    
    // Verify JWT token
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'default-secret-key'
    ) as JWTPayload;
    
    // Check if user exists and is active
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, role, status, organization_id')
      .eq('id', decoded.sub)
      .single();
    
    if (error || !user) {
      throw new ApiError(401, 'Invalid token or user not found');
    }
    
    if (user.status !== 'active') {
      throw new ApiError(403, 'User account is not active');
    }
    
    // Check token blacklist (for logout functionality)
    const { data: blacklisted } = await supabase
      .from('token_blacklist')
      .select('id')
      .eq('token', token)
      .single();
    
    if (blacklisted) {
      throw new ApiError(401, 'Token has been revoked');
    }
    
    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organization_id,
    };
    
    // Log authentication
    logger.debug('User authenticated', {
      userId: user.id,
      role: user.role,
      path: req.path,
    });
    
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new ApiError(401, 'Invalid token'));
    } else if (error instanceof jwt.TokenExpiredError) {
      next(new ApiError(401, 'Token expired'));
    } else {
      next(error);
    }
  }
}

export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    next();
    return;
  }
  
  authenticate(req, res, next);
}