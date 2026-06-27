-- AdminAuditLog table for comprehensive audit trail of all admin operations
CREATE TABLE "AdminAuditLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId" TEXT,
  "userEmail" TEXT,
  "method" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "statusCode" INTEGER NOT NULL,
  "executionTimeMs" REAL NOT NULL,
  "clientIp" TEXT,
  "userAgent" TEXT,
  "requestBody" TEXT,
  "responseBody" TEXT,
  "beforeSnapshot" TEXT,
  "afterSnapshot" TEXT,
  "error" TEXT,
  "changesSummary" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Indexes for common queries
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL
);

-- Performance indexes
CREATE INDEX "AdminAuditLog_timestamp_idx" ON "AdminAuditLog"("timestamp" DESC);
CREATE INDEX "AdminAuditLog_userId_idx" ON "AdminAuditLog"("userId");
CREATE INDEX "AdminAuditLog_method_idx" ON "AdminAuditLog"("method");
CREATE INDEX "AdminAuditLog_path_idx" ON "AdminAuditLog"("path");
CREATE INDEX "AdminAuditLog_statusCode_idx" ON "AdminAuditLog"("statusCode");
CREATE INDEX "AdminAuditLog_userId_timestamp_idx" ON "AdminAuditLog"("userId", "timestamp" DESC);
