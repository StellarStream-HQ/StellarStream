# Audit Log Compliance Implementation

## Overview

This document describes the comprehensive audit logging system implemented for compliance tracking (#HIGH_PRIORITY). The system captures all admin operations, data changes, and provides export/query functionality for compliance audits.

## Components

### 1. Database Model (`AdminAuditLog`)

Located in: `backend/prisma/schema.prisma`

```prisma
model AdminAuditLog {
  id               String    @id @default(cuid())
  timestamp        DateTime  @default(now())
  userId           String?
  userEmail        String?
  method           String    // GET, POST, PUT, DELETE, PATCH
  path             String
  statusCode       Int
  executionTimeMs  Float
  clientIp         String?
  userAgent        String?
  requestBody      String?   // JSON (sanitized)
  responseBody     String?   // JSON (truncated)
  beforeSnapshot   String?   // Data before change
  afterSnapshot    String?   // Data after change
  error            String?   // Error message
  changesSummary   String?   // Human-readable summary
  createdAt        DateTime  @default(now())

  @@index([timestamp(sort: Desc)])
  @@index([userId])
  @@index([method])
  @@index([path])
  @@index([statusCode])
}
```

**Indexes**: Optimized for common query patterns - timestamp, userId, method, path.

### 2. Middleware (`auditLogMiddleware`)

Located in: `backend/src/middleware/audit-log.middleware.ts`

#### Responsibilities:
- Capture all HTTP requests/responses
- Extract client IP (from X-Forwarded-For, X-Real-IP, etc.)
- Sanitize sensitive data (passwords, API keys, credit cards, etc.)
- Truncate large payloads (>5KB)
- Measure execution time
- Capture response status and errors

#### Usage:

```typescript
import { auditLogMiddleware } from './middleware/audit-log.middleware.js';

// Add early in middleware chain (after body parsing)
app.use(express.json());
app.use(auditLogMiddleware);

// In route handlers, set audit context:
import { setAuditContext } from './middleware/audit-log.middleware.js';

app.post('/admin/users', requireAdmin, (req, res) => {
  const beforeData = { status: 'new' };
  const afterData = { status: 'active', name: 'John Doe' };

  setAuditContext(req, {
    userId: req.user?.id,
    userEmail: req.user?.email,
    beforeSnapshot: beforeData,
    afterSnapshot: afterData,
    changesSummary: 'Created new admin user: John Doe',
  });

  // ... handle request
});
```

#### Data Sanitization:

Automatically redacts:
- `password`, `pin`, `secret`, `apiKey`, `token`, `privateKey`
- `seedPhrase`, `mnemonic`, `ssn`, `creditCard`, `cardNumber`

Example:
```json
{
  "name": "John",
  "password": "[REDACTED]",
  "apiKey": "[REDACTED]"
}
```

### 3. Service (`AdminAuditLogService`)

Located in: `backend/src/services/admin-audit-log.service.ts`

#### Methods:

##### Query Logs
```typescript
queryLogs(filters: AuditLogFilters): Promise<{
  logs: AdminAuditLog[];
  total: number;
  hasMore: boolean;
  limit: number;
  offset: number;
}>
```

Supported filters:
- `startDate`, `endDate` - Date range
- `userId`, `userEmail` - User filtering
- `method` - HTTP method (GET, POST, PUT, DELETE)
- `path` - Endpoint path (partial match)
- `statusCode` - HTTP status code
- `minExecutionTime`, `maxExecutionTime` - Performance filtering
- `limit`, `offset` - Pagination

##### Get User Logs
```typescript
getUserLogs(userId: string, limit?: number): Promise<AdminAuditLog[]>
```

##### Get Path Logs
```typescript
getPathLogs(pathPattern: string, limit?: number): Promise<AdminAuditLog[]>
```

##### Get High-Risk Logs
```typescript
getHighRiskLogs(filters?: {
  minExecutionTime?: number;  // default: 5000ms
  statusCode?: number;        // default: 500
  limit?: number;             // default: 100
}): Promise<AdminAuditLog[]>
```

Returns:
- Slow operations (>5 seconds by default)
- Error responses (5xx by default)
- Logs with errors

##### Get Statistics
```typescript
getStatistics(filters?: AuditLogFilters): Promise<{
  totalRequests: number;
  errorRequests: number;
  successRequests: number;
  errorRate: string;          // "5.00"
  avgExecutionTimeMs: string;
  methodStats: Array<{
    method: string;
    count: number;
  }>;
}>
```

##### Export to CSV
```typescript
exportToCSV(filters: AuditLogFilters, outputPath?: string): Promise<string>
```

Returns file path with exported data.

##### Export to JSON
```typescript
exportToJSON(filters: AuditLogFilters, outputPath?: string): Promise<string>
```

Returns file path with exported data.

##### Archive and Clean
```typescript
archiveAndClean(
  beforeDate: Date,
  format?: 'csv' | 'json'
): Promise<{ archivedPath: string; deletedCount: number }>
```

Exports logs older than `beforeDate` and deletes them (retention policy).

### 4. API Routes

Located in: `backend/src/api/audit-log.routes.ts`

All endpoints require `requireAdmin` middleware.

#### GET /api/audit/logs
Query audit logs with filters.

**Query Parameters:**
```
?startDate=2024-01-01T00:00:00Z
&endDate=2024-01-31T23:59:59Z
&userId=user-123
&userEmail=john@example.com
&method=POST
&path=/admin/users
&statusCode=200
&minExecutionTime=100
&maxExecutionTime=5000
&limit=100
&offset=0
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "audit-1",
      "timestamp": "2024-01-15T10:30:00Z",
      "userId": "user-123",
      "userEmail": "john@example.com",
      "method": "POST",
      "path": "/admin/users",
      "statusCode": 201,
      "executionTimeMs": 250,
      "clientIp": "192.168.1.1",
      "userAgent": "Mozilla/5.0",
      "changesSummary": "Created new user",
      "error": null
    }
  ],
  "pagination": {
    "total": 1000,
    "limit": 100,
    "offset": 0,
    "hasMore": true
  }
}
```

#### GET /api/audit/logs/user/:userId
Get all operations by specific user.

**Response:**
```json
{
  "success": true,
  "data": [ /* audit logs */ ]
}
```

#### GET /api/audit/logs/path
Get operations for specific endpoint path.

**Query Parameters:**
```
?pattern=/admin/users
&limit=50
```

#### GET /api/audit/logs/high-risk
Get high-risk operations (errors, slow requests).

**Query Parameters:**
```
?minExecutionTime=5000  // default
&statusCode=500         // default
&limit=100
```

#### GET /api/audit/statistics
Get audit statistics (compliance dashboard).

**Query Parameters:**
```
?startDate=2024-01-01T00:00:00Z
&endDate=2024-01-31T23:59:59Z
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalRequests": 5000,
    "errorRequests": 50,
    "successRequests": 4950,
    "errorRate": "1.00",
    "avgExecutionTimeMs": "245.50",
    "methodStats": [
      { "method": "GET", "count": 3000 },
      { "method": "POST", "count": 1500 },
      { "method": "PUT", "count": 400 },
      { "method": "DELETE", "count": 100 }
    ]
  }
}
```

#### POST /api/audit/export
Export audit logs to CSV or JSON.

**Request Body:**
```json
{
  "format": "csv",  // or "json"
  "filters": {
    "startDate": "2024-01-01T00:00:00Z",
    "endDate": "2024-01-31T23:59:59Z",
    "userId": "user-123",
    "statusCode": 500
  }
}
```

**Response:** File download (CSV or JSON)

#### POST /api/audit/archive
Archive old logs and clean database (retention policy).

**Request Body:**
```json
{
  "beforeDate": "2023-01-01T00:00:00Z",
  "format": "json"  // or "csv"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "archivedPath": "/exports/audit-log-1234567890.json",
    "deletedCount": 5000,
    "message": "5000 records archived and deleted"
  }
}
```

## Integration Steps

### 1. Update Backend Main File

```typescript
// src/index.ts or src/api.ts
import { auditLogMiddleware } from './middleware/audit-log.middleware.js';
import auditLogRoutes from './api/audit-log.routes.js';

// Add middleware early in chain (after body parsing)
app.use(express.json());
app.use(auditLogMiddleware);

// Add routes
app.use(auditLogRoutes);
```

### 2. Run Database Migration

```bash
npx prisma migrate dev --name add_admin_audit_log
```

### 3. Use in Admin Routes

```typescript
import { setAuditContext } from '../middleware/audit-log.middleware.js';

router.post('/admin/users', requireAdmin, async (req, res) => {
  try {
    const beforeData = null;
    const newUser = await createUser(req.body);
    
    setAuditContext(req, {
      userId: req.user.id,
      userEmail: req.user.email,
      beforeSnapshot: beforeData,
      afterSnapshot: newUser,
      changesSummary: `Created user: ${newUser.email}`,
    });

    res.json({ success: true, data: newUser });
  } catch (error) {
    setAuditContext(req, {
      userId: req.user.id,
      userEmail: req.user.email,
      changesSummary: 'Failed to create user',
    });
    res.status(400).json({ error: error.message });
  }
});
```

## Compliance Checklist

✅ **Request Capture:**
- [x] HTTP method, path, timestamp
- [x] User ID and email
- [x] Client IP address
- [x] User-Agent

✅ **Response Capture:**
- [x] Status code
- [x] Execution time
- [x] Response body (truncated)
- [x] Error messages

✅ **Data Changes:**
- [x] Before/after snapshots
- [x] Human-readable change summary
- [x] Field-level tracking available

✅ **Security:**
- [x] Sensitive data sanitization
- [x] Database encryption ready (via Prisma)
- [x] Access control (requireAdmin)

✅ **Export/Audit Trail:**
- [x] CSV export
- [x] JSON export
- [x] Query endpoint with filters
- [x] Statistics dashboard

✅ **Testing:**
- [x] 10+ unit tests for middleware
- [x] 10+ unit tests for service
- [x] Coverage for all scenarios

## Performance Considerations

1. **Indexes**: Optimized for common query patterns
2. **Truncation**: Large payloads truncated to 5KB
3. **Async Logging**: Non-blocking database writes
4. **Retention**: Archive and clean old logs regularly

## Retention Policy

Recommended cleanup:
```typescript
// Archive logs older than 90 days monthly
const threeMonthsAgo = new Date();
threeMonthsAgo.setDate(threeMonthsAgo.getDate() - 90);

await adminAuditLogService.archiveAndClean(threeMonthsAgo, 'json');
```

## Testing

Run tests:
```bash
npm run test audit-log
```

Test coverage:
- ✅ Request/response capture
- ✅ Sensitive data sanitization
- ✅ Execution time measurement
- ✅ Client IP extraction
- ✅ Query filtering
- ✅ Export functionality
- ✅ High-risk detection
- ✅ Statistics calculation
- ✅ Archive and cleanup
- ✅ Error handling

## Compliance Metrics

Track with `/api/audit/statistics`:

```json
{
  "totalRequests": 5000,
  "errorRequests": 50,
  "successRequests": 4950,
  "errorRate": "1.00%",
  "avgExecutionTimeMs": "245.50",
  "operationsByType": "GET (60%), POST (30%), PUT (8%), DELETE (2%)"
}
```

## Security Notes

1. **Data Sanitization**: Automatic redaction of sensitive fields
2. **Access Control**: All audit endpoints require `requireAdmin`
3. **Immutable Logs**: Once written, logs are immutable (append-only)
4. **Integrity**: Consider adding hash chain for tamper detection
5. **Encryption**: Enable Prisma encryption for sensitive columns

## Future Enhancements

- [ ] Hash chain for tamper detection (similar to EventLog)
- [ ] Encrypted storage for sensitive snapshots
- [ ] Real-time compliance dashboard
- [ ] Automated alerts for high-risk operations
- [ ] Machine learning anomaly detection
- [ ] Legal hold for compliance holds
