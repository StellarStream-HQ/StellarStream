# Audit Log - Quick Start Guide

## 5-Minute Setup

### Step 1: Run Database Migration
```bash
cd backend
npx prisma migrate dev --name add_admin_audit_log
```

### Step 2: Add Middleware to Your App

In `backend/src/index.ts` or `backend/src/api.ts`:

```typescript
import express from 'express';
import { auditLogMiddleware } from './middleware/audit-log.middleware.js';
import auditLogRoutes from './api/audit-log.routes.js';

const app = express();

// Parse body BEFORE audit middleware
app.use(express.json());

// Add audit middleware (IMPORTANT: after body parser)
app.use(auditLogMiddleware);

// Mount audit log routes
app.use(auditLogRoutes);

// ... rest of your routes
```

### Step 3: Use in Your Admin Routes

```typescript
import { setAuditContext } from '../middleware/audit-log.middleware.js';

router.post('/admin/users', requireAdmin, async (req, res) => {
  try {
    // Create user
    const newUser = await createUser(req.body);
    
    // Record audit context
    setAuditContext(req, {
      userId: req.user?.id,
      userEmail: req.user?.email,
      beforeSnapshot: null,
      afterSnapshot: newUser,
      changesSummary: `Created admin user: ${newUser.email}`,
    });

    res.json({ success: true, data: newUser });
  } catch (error) {
    // Even on error, context is recorded
    res.status(400).json({ error: error.message });
  }
});
```

## Available Endpoints

### Query Audit Logs
```bash
GET /api/audit/logs?method=POST&limit=50&offset=0
GET /api/audit/logs/user/user-123
GET /api/audit/logs/path?pattern=/admin/users
GET /api/audit/logs/high-risk?minExecutionTime=5000
GET /api/audit/statistics
```

### Export Logs
```bash
POST /api/audit/export
Content-Type: application/json

{
  "format": "csv",
  "filters": {
    "startDate": "2024-01-01",
    "endDate": "2024-01-31"
  }
}
```

### Archive Old Logs
```bash
POST /api/audit/archive
Content-Type: application/json

{
  "beforeDate": "2023-10-15",
  "format": "json"
}
```

## Key Features

✅ **Automatic Capture**
- HTTP method, path, status, execution time
- User info, client IP, User-Agent
- Request/response bodies
- Before/after data snapshots

✅ **Secure**
- Passwords, API keys, credit cards automatically redacted
- All endpoints require admin access
- Large payloads truncated to prevent bloat

✅ **Queryable**
- Filter by date, user, method, path, status code
- Pagination support
- High-risk detection (errors, slow requests)

✅ **Exportable**
- CSV and JSON formats
- 10,000 records per export
- Retention policy with archive

## Testing

```bash
# Run audit log tests
npm run test -- audit-log.middleware
npm run test -- admin-audit-log.service
```

## Common Queries

### Get all failures in an endpoint
```bash
curl "http://localhost:3000/api/audit/logs?path=/admin/users&statusCode=400"
```

### Get a user's activity
```bash
curl "http://localhost:3000/api/audit/logs/user/user-123?limit=100"
```

### Get slow operations
```bash
curl "http://localhost:3000/api/audit/logs/high-risk?minExecutionTime=10000"
```

### Export January activity
```bash
curl -X POST http://localhost:3000/api/audit/export \
  -H "Content-Type: application/json" \
  -d '{
    "format": "csv",
    "filters": {
      "startDate": "2024-01-01",
      "endDate": "2024-01-31"
    }
  }' > audit-january.csv
```

## Retention Policy

Set up a cron job to run monthly:

```typescript
import { AdminAuditLogService } from './services/admin-audit-log.service.js';

// Archive logs older than 90 days
const service = new AdminAuditLogService();
const threeMonthsAgo = new Date();
threeMonthsAgo.setDate(threeMonthsAgo.getDate() - 90);

await service.archiveAndClean(threeMonthsAgo, 'json');
```

## Response Example

```json
{
  "success": true,
  "data": [
    {
      "id": "audit-123",
      "timestamp": "2024-01-15T10:30:00Z",
      "userId": "user-456",
      "userEmail": "john@example.com",
      "method": "POST",
      "path": "/admin/users",
      "statusCode": 201,
      "executionTimeMs": 245,
      "clientIp": "192.168.1.1",
      "userAgent": "Mozilla/5.0",
      "changesSummary": "Created admin user: john@example.com",
      "error": null
    }
  ],
  "pagination": {
    "total": 1000,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  }
}
```

## Troubleshooting

### Logs not being recorded?
1. Make sure middleware is added AFTER body parser
2. Check that `requireAdmin` is working
3. Verify database migration ran: `npx prisma db push`

### Can't export logs?
1. Check disk space
2. Verify file write permissions
3. Try different format (CSV vs JSON)

### Performance issues?
1. Implement retention policy (archive old logs)
2. Review indexes are created
3. Check database connection pooling

## Next Steps

1. ✅ Run migration
2. ✅ Add middleware
3. ✅ Mount routes
4. ✅ Update admin routes with `setAuditContext()`
5. ✅ Test endpoints
6. ✅ Set up compliance dashboard
7. ✅ Configure retention policy

**That's it! Your audit logging is now compliance-ready.** 🎉
