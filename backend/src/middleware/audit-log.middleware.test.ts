import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Request, Response } from 'express';
import { auditLogMiddleware, setAuditContext } from './audit-log.middleware.js';
import { prisma } from '../lib/db.js';

// Mock Prisma
vi.mock('../lib/db.js', () => ({
  prisma: {
    adminAuditLog: {
      create: vi.fn(),
    },
  },
}));

describe('auditLogMiddleware', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    next = vi.fn();

    req = {
      method: 'POST',
      path: '/admin/users',
      headers: {
        'user-agent': 'Mozilla/5.0',
        'x-forwarded-for': '192.168.1.1',
      },
      body: { name: 'John Doe' },
      socket: {
        remoteAddress: '127.0.0.1',
      } as any,
    };

    res = {
      statusCode: 200,
      json: vi.fn(function (data) {
        this.statusCode = 200;
        return this;
      }),
      send: vi.fn(function (data) {
        this.statusCode = 200;
        return this;
      }),
      on: vi.fn(function (event, callback) {
        if (event === 'finish') {
          // Simulate response finish
          setTimeout(() => callback(), 10);
        }
        return this;
      }),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize audit context on request', () => {
    auditLogMiddleware(req as Request, res as Response, next);
    expect(req.auditLog).toBeDefined();
    expect(req.auditLog?.entryId).toBeDefined();
    expect(next).toHaveBeenCalled();
  });

  it('should capture GET request without body', async () => {
    req.method = 'GET';
    req.body = undefined;

    auditLogMiddleware(req as Request, res as Response, next);

    // Trigger finish event
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(prisma.adminAuditLog.create).toHaveBeenCalled();
    const callArgs = (prisma.adminAuditLog.create as any).mock.calls[0][0].data;
    expect(callArgs.method).toBe('GET');
    expect(callArgs.requestBody).toBeNull();
  });

  it('should capture POST request with body', async () => {
    auditLogMiddleware(req as Request, res as Response, next);

    // Trigger finish event
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(prisma.adminAuditLog.create).toHaveBeenCalled();
    const callArgs = (prisma.adminAuditLog.create as any).mock.calls[0][0].data;
    expect(callArgs.method).toBe('POST');
    expect(callArgs.requestBody).toBeTruthy();
  });

  it('should extract client IP from X-Forwarded-For', async () => {
    auditLogMiddleware(req as Request, res as Response, next);

    // Trigger finish event
    await new Promise(resolve => setTimeout(resolve, 50));

    const callArgs = (prisma.adminAuditLog.create as any).mock.calls[0][0].data;
    expect(callArgs.clientIp).toBe('192.168.1.1');
  });

  it('should sanitize sensitive data', async () => {
    req.body = {
      name: 'John',
      password: 'secret123',
      apiKey: 'key_12345',
      nested: {
        creditCard: '4111-1111-1111-1111',
      },
    };

    auditLogMiddleware(req as Request, res as Response, next);

    // Trigger finish event
    await new Promise(resolve => setTimeout(resolve, 50));

    const callArgs = (prisma.adminAuditLog.create as any).mock.calls[0][0].data;
    const requestBody = JSON.parse(callArgs.requestBody);
    
    expect(requestBody.password).toBe('[REDACTED]');
    expect(requestBody.apiKey).toBe('[REDACTED]');
    expect(requestBody.nested.creditCard).toBe('[REDACTED]');
    expect(requestBody.name).toBe('John');
  });

  it('should record execution time', async () => {
    auditLogMiddleware(req as Request, res as Response, next);

    // Trigger finish event
    await new Promise(resolve => setTimeout(resolve, 50));

    const callArgs = (prisma.adminAuditLog.create as any).mock.calls[0][0].data;
    expect(callArgs.executionTimeMs).toBeGreaterThanOrEqual(0);
    expect(typeof callArgs.executionTimeMs).toBe('number');
  });

  it('should set user context via setAuditContext', () => {
    auditLogMiddleware(req as Request, res as Response, next);

    setAuditContext(req as Request, {
      userId: 'user-123',
      userEmail: 'john@example.com',
      changesSummary: 'Created new user',
    });

    expect(req.auditLog?.userId).toBe('user-123');
    expect(req.auditLog?.userEmail).toBe('john@example.com');
    expect(req.auditLog?.changesSummary).toBe('Created new user');
  });

  it('should record before and after snapshots', async () => {
    const beforeData = { status: 'inactive' };
    const afterData = { status: 'active' };

    setAuditContext(req as Request, {
      beforeSnapshot: beforeData,
      afterSnapshot: afterData,
    });

    auditLogMiddleware(req as Request, res as Response, next);

    // Trigger finish event
    await new Promise(resolve => setTimeout(resolve, 50));

    const callArgs = (prisma.adminAuditLog.create as any).mock.calls[0][0].data;
    expect(JSON.parse(callArgs.beforeSnapshot)).toEqual(beforeData);
    expect(JSON.parse(callArgs.afterSnapshot)).toEqual(afterData);
  });

  it('should truncate large response bodies', async () => {
    const largeResponse = { data: 'x'.repeat(10000) };
    (res as any).json = vi.fn(function () {
      (req as any).responseBody = largeResponse;
      return this;
    });

    auditLogMiddleware(req as Request, res as Response, next);

    // Trigger finish event
    await new Promise(resolve => setTimeout(resolve, 50));

    const callArgs = (prisma.adminAuditLog.create as any).mock.calls[0][0].data;
    expect(callArgs.responseBody.length).toBeLessThan(10000);
    expect(callArgs.responseBody).toContain('truncated');
  });

  it('should capture error responses', async () => {
    (res as any).statusCode = 500;

    auditLogMiddleware(req as Request, res as Response, next);

    // Trigger finish event
    await new Promise(resolve => setTimeout(resolve, 50));

    const callArgs = (prisma.adminAuditLog.create as any).mock.calls[0][0].data;
    expect(callArgs.statusCode).toBe(500);
    expect(callArgs.error).toBeTruthy();
  });

  it('should handle database errors gracefully', async () => {
    (prisma.adminAuditLog.create as any).mockRejectedValueOnce(
      new Error('Database error')
    );

    // Should not throw
    expect(() => {
      auditLogMiddleware(req as Request, res as Response, next);
    }).not.toThrow();

    expect(next).toHaveBeenCalled();
  });
});
