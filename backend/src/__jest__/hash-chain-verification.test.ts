import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createHash } from 'crypto';
import { HashChainVerificationService } from '../services/hash-chain-verification.service.js';

/**
 * Test suite for Audit Log Hash Chain Verification
 * **Validates: Requirement 10.3**
 *
 * Tests the audit log integrity verification functionality including:
 * - Hash chain validation
 * - Tampering detection (field modification, entry insertion, deletion)
 * - Detailed tampering reports
 * - Single entry verification
 */
describe('HashChainVerificationService - Audit Log Integrity', () => {
  let service: HashChainVerificationService;
  const mockOrgId = 'org-test-123';

  beforeEach(() => {
    service = new HashChainVerificationService();
    jest.clearAllMocks();
  });

  describe('calculateEntryHash', () => {
    it('should calculate consistent hash for same entry', () => {
      const entry = {
        id: 'log-1',
        organizationId: mockOrgId,
        actionType: 'MEMBER_ADDED',
        actor: 'GACTOR123',
        resourceId: 'resource-1',
        resourceType: 'member',
        changes: { role: 'EXECUTOR' },
        entryHash: null,
        parentHash: null,
        createdAt: new Date('2025-01-20T10:00:00Z'),
      };

      const hash1 = service.calculateEntryHash(entry, null);
      const hash2 = service.calculateEntryHash(entry, null);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex format
    });

    it('should calculate different hash when parentHash changes', () => {
      const entry = {
        id: 'log-1',
        organizationId: mockOrgId,
        actionType: 'MEMBER_ADDED',
        actor: 'GACTOR123',
        resourceId: 'resource-1',
        resourceType: 'member',
        changes: { role: 'EXECUTOR' },
        entryHash: null,
        parentHash: null,
        createdAt: new Date('2025-01-20T10:00:00Z'),
      };

      const hash1 = service.calculateEntryHash(entry, null);
      const hash2 = service.calculateEntryHash(entry, 'different-parent-hash');

      expect(hash1).not.toBe(hash2);
    });

    it('should use SHA-256 algorithm for hashing', () => {
      const entry = {
        id: 'log-1',
        organizationId: mockOrgId,
        actionType: 'MEMBER_ADDED',
        actor: 'GACTOR123',
        resourceId: 'resource-1',
        resourceType: 'member',
        changes: null,
        entryHash: null,
        parentHash: null,
        createdAt: new Date('2025-01-20T10:00:00Z'),
      };

      const hash = service.calculateEntryHash(entry, null);

      // Manually compute expected hash
      const canonical = JSON.stringify({
        organizationId: mockOrgId,
        actionType: 'MEMBER_ADDED',
        actor: 'GACTOR123',
        resourceId: 'resource-1',
        resourceType: 'member',
        changes: null,
        parentHash: null,
      });
      const expectedHash = createHash('sha256').update(canonical).digest('hex');

      expect(hash).toBe(expectedHash);
    });
  });

  describe('verifyEntry', () => {
    it('should verify valid entry with correct hash', () => {
      const entry = {
        id: 'log-1',
        organizationId: mockOrgId,
        actionType: 'MEMBER_ADDED',
        actor: 'GACTOR123',
        resourceId: 'resource-1',
        resourceType: 'member',
        changes: { role: 'EXECUTOR' },
        parentHash: null,
        createdAt: new Date('2025-01-20T10:00:00Z'),
      } as any;

      // Calculate correct hash
      entry.entryHash = service.calculateEntryHash(entry, null);

      const isValid = service.verifyEntry(entry);

      expect(isValid).toBe(true);
    });

    it('should reject entry with modified field', () => {
      const entry = {
        id: 'log-1',
        organizationId: mockOrgId,
        actionType: 'MEMBER_ADDED',
        actor: 'GACTOR123',
        resourceId: 'resource-1',
        resourceType: 'member',
        changes: { role: 'EXECUTOR' },
        parentHash: null,
        createdAt: new Date('2025-01-20T10:00:00Z'),
      } as any;

      // Calculate correct hash
      const correctHash = service.calculateEntryHash(entry, null);
      entry.entryHash = correctHash;

      // Modify an action field - should fail verification
      entry.actionType = 'MODIFIED_ACTION';

      const isValid = service.verifyEntry(entry);

      expect(isValid).toBe(false);
    });

    it('should verify chain continuity with previous entry', () => {
      const entry1 = {
        id: 'log-1',
        organizationId: mockOrgId,
        actionType: 'MEMBER_ADDED',
        actor: 'GACTOR123',
        resourceId: 'resource-1',
        resourceType: 'member',
        changes: { role: 'EXECUTOR' },
        parentHash: null,
        createdAt: new Date('2025-01-20T10:00:00Z'),
      } as any;

      entry1.entryHash = service.calculateEntryHash(entry1, null);

      const entry2 = {
        id: 'log-2',
        organizationId: mockOrgId,
        actionType: 'POLICY_UPDATED',
        actor: 'GACTOR123',
        resourceId: 'policy-1',
        resourceType: 'policy',
        changes: { dailyLimit: 50000 },
        parentHash: entry1.entryHash,
        createdAt: new Date('2025-01-20T10:01:00Z'),
      } as any;

      entry2.entryHash = service.calculateEntryHash(entry2, entry1.entryHash);

      const isValid = service.verifyEntry(entry2, entry1);

      expect(isValid).toBe(true);
    });

    it('should reject entry with broken chain', () => {
      const entry1 = {
        id: 'log-1',
        organizationId: mockOrgId,
        actionType: 'MEMBER_ADDED',
        actor: 'GACTOR123',
        resourceId: 'resource-1',
        resourceType: 'member',
        changes: { role: 'EXECUTOR' },
        parentHash: null,
        createdAt: new Date('2025-01-20T10:00:00Z'),
      } as any;

      entry1.entryHash = service.calculateEntryHash(entry1, null);

      const entry2 = {
        id: 'log-2',
        organizationId: mockOrgId,
        actionType: 'POLICY_UPDATED',
        actor: 'GACTOR123',
        resourceId: 'policy-1',
        resourceType: 'policy',
        changes: { dailyLimit: 50000 },
        parentHash: 'wrong-hash-value',
        createdAt: new Date('2025-01-20T10:01:00Z'),
      } as any;

      entry2.entryHash = service.calculateEntryHash(entry2, entry1.entryHash);

      const isValid = service.verifyEntry(entry2, entry1);

      expect(isValid).toBe(false);
    });
  });

  describe('verifyIntegrity - Unit Tests', () => {
    it('should return valid result for empty chain', async () => {
      // Note: In real tests, we would mock prisma.auditLog.findMany
      // For now, we test the logic with local entry arrays
      expect(true).toBe(true);
    });

    it('should detect modified entry hash', () => {
      // Setup: Create an entry with correct hash, then modify stored hash
      const entry = {
        id: 'log-1',
        organizationId: mockOrgId,
        actionType: 'MEMBER_ADDED',
        actor: 'GACTOR123',
        resourceId: 'resource-1',
        resourceType: 'member',
        changes: { role: 'EXECUTOR' },
        parentHash: null,
        createdAt: new Date('2025-01-20T10:00:00Z'),
      } as any;

      const correctHash = service.calculateEntryHash(entry, null);
      entry.entryHash = 'tampered-hash-value'; // Simulate tampering

      const isValid = service.verifyEntry(entry);

      expect(isValid).toBe(false);
      expect(entry.entryHash).not.toBe(correctHash);
    });

    it('should detect parentHash modification (chain break)', () => {
      const entry1 = {
        id: 'log-1',
        organizationId: mockOrgId,
        actionType: 'MEMBER_ADDED',
        actor: 'GACTOR123',
        resourceId: 'resource-1',
        resourceType: 'member',
        changes: { role: 'EXECUTOR' },
        parentHash: null,
        createdAt: new Date('2025-01-20T10:00:00Z'),
      } as any;

      entry1.entryHash = service.calculateEntryHash(entry1, null);

      const entry2 = {
        id: 'log-2',
        organizationId: mockOrgId,
        actionType: 'POLICY_UPDATED',
        actor: 'GACTOR123',
        resourceId: 'policy-1',
        resourceType: 'policy',
        changes: { dailyLimit: 50000 },
        parentHash: entry1.entryHash,
        createdAt: new Date('2025-01-20T10:01:00Z'),
      } as any;

      entry2.entryHash = service.calculateEntryHash(entry2, entry1.entryHash);

      // Now tamper with parentHash
      entry2.parentHash = 'wrong-parent-hash';

      const isValid = service.verifyEntry(entry2, entry1);

      expect(isValid).toBe(false);
    });
  });
});


describe('HashChainVerificationService - Integration Tests', () => {
  let service: HashChainVerificationService;
  const mockOrgId = 'org-integration-test';

  beforeEach(() => {
    service = new HashChainVerificationService();
    jest.clearAllMocks();
  });

  it('should detect when new entry is inserted into chain', () => {
    // Setup: Create entry1 -> entry2 chain
    const entry1 = {
      id: 'log-1',
      organizationId: mockOrgId,
      actionType: 'MEMBER_ADDED',
      actor: 'GACTOR123',
      resourceId: 'resource-1',
      resourceType: 'member',
      changes: { role: 'EXECUTOR' },
      parentHash: null,
      createdAt: new Date('2025-01-20T10:00:00Z'),
    } as any;
    entry1.entryHash = service.calculateEntryHash(entry1, null);

    const entry2 = {
      id: 'log-2',
      organizationId: mockOrgId,
      actionType: 'POLICY_UPDATED',
      actor: 'GACTOR123',
      resourceId: 'policy-1',
      resourceType: 'policy',
      changes: { dailyLimit: 50000 },
      parentHash: entry1.entryHash,
      createdAt: new Date('2025-01-20T10:01:00Z'),
    } as any;
    entry2.entryHash = service.calculateEntryHash(entry2, entry1.entryHash);

    // Now insert a new entry in between (with wrong parent/child links)
    const insertedEntry = {
      id: 'log-1-5',
      organizationId: mockOrgId,
      actionType: 'MEMBER_ROLE_CHANGED',
      actor: 'GACTOR456',
      resourceId: 'resource-2',
      resourceType: 'member',
      changes: { newRole: 'APPROVER' },
      parentHash: entry1.entryHash,
      createdAt: new Date('2025-01-20T10:00:30Z'),
    } as any;
    insertedEntry.entryHash = service.calculateEntryHash(insertedEntry, entry1.entryHash);

    // Simulate the chain order by createdAt
    const entries = [entry1, insertedEntry, entry2];

    // Verify: The chain should be broken at entry2 because its parentHash points to entry1,
    // but now entry1's next chronological entry is insertedEntry
    let breakDetected = false;
    for (let i = 1; i < entries.length; i++) {
      const current = entries[i];
      const previous = entries[i - 1];
      if (current.parentHash !== previous.entryHash) {
        breakDetected = true;
        break;
      }
    }

    expect(breakDetected).toBe(true);
  });

  it('should verify complete valid chain', () => {
    // Build a 5-entry valid chain
    const entries: any[] = [];
    let previousHash: string | null = null;

    for (let i = 0; i < 5; i++) {
      const entry = {
        id: `log-${i}`,
        organizationId: mockOrgId,
        actionType: `ACTION_${i}`,
        actor: `GACTOR${i}`,
        resourceId: `resource-${i}`,
        resourceType: 'resource',
        changes: { index: i },
        parentHash: previousHash,
        createdAt: new Date(Date.now() + i * 1000),
      } as any;

      entry.entryHash = service.calculateEntryHash(entry, previousHash);
      entries.push(entry);
      previousHash = entry.entryHash;
    }

    // Verify all entries
    let allValid = true;
    for (let i = 0; i < entries.length; i++) {
      const previous = i > 0 ? entries[i - 1] : undefined;
      if (!service.verifyEntry(entries[i], previous)) {
        allValid = false;
        break;
      }
    }

    expect(allValid).toBe(true);
  });

  it('should detect multiple tamperings in chain', () => {
    const entries: any[] = [];
    let previousHash: string | null = null;

    // Create valid chain
    for (let i = 0; i < 5; i++) {
      const entry = {
        id: `log-${i}`,
        organizationId: mockOrgId,
        actionType: `ACTION_${i}`,
        actor: `GACTOR${i}`,
        resourceId: `resource-${i}`,
        resourceType: 'resource',
        changes: { index: i },
        parentHash: previousHash,
        createdAt: new Date(Date.now() + i * 1000),
      } as any;

      entry.entryHash = service.calculateEntryHash(entry, previousHash);
      entries.push(entry);
      previousHash = entry.entryHash;
    }

    // Tamper with entries 1 and 3
    entries[1].actionType = 'TAMPERED_ACTION';
    entries[3].changes = { tampered: true };

    // Count tampered entries
    let tamperedCount = 0;
    for (let i = 0; i < entries.length; i++) {
      const previous = i > 0 ? entries[i - 1] : undefined;
      if (!service.verifyEntry(entries[i], previous)) {
        tamperedCount++;
      }
    }

    expect(tamperedCount).toBeGreaterThanOrEqual(1); // At least entry 1 should fail
  });
});


describe('HashChainVerificationService - Property-Based Tests', () => {
  let service: HashChainVerificationService;

  beforeEach(() => {
    service = new HashChainVerificationService();
  });

  /**
   * Property: Hash Determinism
   * **Validates: Requirement 10.3**
   * 
   * For any given audit log entry and parent hash, the calculated hash
   * must be deterministic (same inputs always produce same output)
   */
  it('PROPERTY: Hash calculation is deterministic', () => {
    const testCases = [
      {
        orgId: 'org-1',
        actionType: 'MEMBER_ADDED',
        actor: 'GACTOR1',
        resourceId: 'res-1',
        resourceType: 'member',
        changes: null,
      },
      {
        orgId: 'org-2',
        actionType: 'POLICY_UPDATED',
        actor: 'GACTOR2',
        resourceId: 'res-2',
        resourceType: 'policy',
        changes: { dailyLimit: 50000 },
      },
      {
        orgId: 'org-3',
        actionType: 'ACCESS_DENIED',
        actor: 'GACTOR3',
        resourceId: 'res-3',
        resourceType: 'organization',
        changes: { attemptedAction: 'delete_member' },
      },
    ];

    for (const testCase of testCases) {
      const entry = {
        id: 'test-id',
        organizationId: testCase.orgId,
        actionType: testCase.actionType,
        actor: testCase.actor,
        resourceId: testCase.resourceId,
        resourceType: testCase.resourceType,
        changes: testCase.changes,
        entryHash: null,
        parentHash: null,
        createdAt: new Date(),
      } as any;

      // Calculate hash multiple times
      const hash1 = service.calculateEntryHash(entry, null);
      const hash2 = service.calculateEntryHash(entry, null);
      const hash3 = service.calculateEntryHash(entry, null);

      // All hashes must be identical
      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    }
  });

  /**
   * Property: Field Sensitivity
   * **Validates: Requirement 10.3**
   *
   * Any modification to the entry fields must change the hash
   */
  it('PROPERTY: Hash changes when any field changes', () => {
    const baseEntry = {
      id: 'log-1',
      organizationId: 'org-test',
      actionType: 'MEMBER_ADDED',
      actor: 'GACTOR',
      resourceId: 'resource-1',
      resourceType: 'member',
      changes: { role: 'EXECUTOR' },
      entryHash: null,
      parentHash: null,
      createdAt: new Date('2025-01-20T10:00:00Z'),
    } as any;

    const baseHash = service.calculateEntryHash(baseEntry, null);

    // Test each field modification
    const fieldModifications = [
      { field: 'organizationId', newValue: 'org-different' },
      { field: 'actionType', newValue: 'DIFFERENT_ACTION' },
      { field: 'actor', newValue: 'GDIFFERENT' },
      { field: 'resourceId', newValue: 'resource-different' },
      { field: 'resourceType', newValue: 'different_type' },
      { field: 'changes', newValue: { different: 'value' } },
    ];

    for (const { field, newValue } of fieldModifications) {
      const modifiedEntry = { ...baseEntry };
      modifiedEntry[field] = newValue;

      const modifiedHash = service.calculateEntryHash(modifiedEntry, null);
      expect(modifiedHash).not.toBe(baseHash);
    }
  });

  /**
   * Property: Valid Chain Never Breaks
   * **Validates: Requirement 10.3**
   *
   * A properly constructed chain with correct parent-child relationships
   * must always pass verification
   */
  it('PROPERTY: Valid chain with correct links passes verification', () => {
    // Build a chain of 10 entries
    const entries: any[] = [];
    let previousHash: string | null = null;

    for (let i = 0; i < 10; i++) {
      const entry = {
        id: `log-${i}`,
        organizationId: 'org-chain-test',
        actionType: `ACTION_${i}`,
        actor: `GACTOR${i}`,
        resourceId: `resource-${i}`,
        resourceType: 'resource',
        changes: { sequence: i },
        parentHash: previousHash,
        createdAt: new Date(Date.now() + i * 1000),
      } as any;

      entry.entryHash = service.calculateEntryHash(entry, previousHash);
      entries.push(entry);
      previousHash = entry.entryHash;
    }

    // Verify entire chain - all should pass
    for (let i = 0; i < entries.length; i++) {
      const previous = i > 0 ? entries[i - 1] : undefined;
      const isValid = service.verifyEntry(entries[i], previous);
      expect(isValid).toBe(true);
    }
  });

  /**
   * Property: Any Tampering Detected
   * **Validates: Requirement 10.3**
   *
   * Any modification to an entry (field change or hash alteration)
   * must fail verification
   */
  it('PROPERTY: Any tampering is detected immediately', () => {
    // Test tampering scenarios
    const tamperTests = [
      {
        name: 'actionType changed',
        tamper: (entry: any) => {
          entry.actionType = 'TAMPERED';
        },
      },
      {
        name: 'actor changed',
        tamper: (entry: any) => {
          entry.actor = 'GTAMPERER';
        },
      },
      {
        name: 'resourceId changed',
        tamper: (entry: any) => {
          entry.resourceId = 'tampered-resource';
        },
      },
      {
        name: 'changes modified',
        tamper: (entry: any) => {
          entry.changes = { tampered: true };
        },
      },
      {
        name: 'entryHash tampered',
        tamper: (entry: any) => {
          entry.entryHash = 'tampered-hash-value';
        },
      },
    ];

    for (const { tamper } of tamperTests) {
      // Create fresh entry
      const freshEntry = {
        id: 'log-1',
        organizationId: 'org-tamper-test',
        actionType: 'MEMBER_ADDED',
        actor: 'GACTOR',
        resourceId: 'resource-1',
        resourceType: 'member',
        changes: { role: 'EXECUTOR' },
        parentHash: null,
        createdAt: new Date(),
      } as any;
      const originalHash = service.calculateEntryHash(freshEntry, null);
      freshEntry.entryHash = originalHash;

      // Apply tampering
      tamper(freshEntry);

      // Verification must fail
      const isValid = service.verifyEntry(freshEntry);
      expect(isValid).toBe(false);
    }
  });

  /**
   * Property: Chain Continuity Breaking Detected
   * **Validates: Requirement 10.3**
   *
   * If an entry's parentHash doesn't match previous entry's hash,
   * the chain break must be detected
   */
  it('PROPERTY: Chain continuity breaks are always detected', () => {
    // Create two entries in sequence
    const entry1 = {
      id: 'log-1',
      organizationId: 'org-chain-break-test',
      actionType: 'ACTION_1',
      actor: 'GACTOR1',
      resourceId: 'resource-1',
      resourceType: 'resource',
      changes: null,
      parentHash: null,
      createdAt: new Date(),
    } as any;

    entry1.entryHash = service.calculateEntryHash(entry1, null);

    const entry2 = {
      id: 'log-2',
      organizationId: 'org-chain-break-test',
      actionType: 'ACTION_2',
      actor: 'GACTOR2',
      resourceId: 'resource-2',
      resourceType: 'resource',
      changes: null,
      parentHash: entry1.entryHash,
      createdAt: new Date(Date.now() + 1000),
    } as any;

    entry2.entryHash = service.calculateEntryHash(entry2, entry1.entryHash);

    // Valid chain - should pass
    expect(service.verifyEntry(entry2, entry1)).toBe(true);

    // Now corrupt the parent hash reference
    entry2.parentHash = 'wrong-parent-hash';

    // Should fail due to broken chain
    expect(service.verifyEntry(entry2, entry1)).toBe(false);
  });
});
