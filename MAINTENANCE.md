# Maintenance Schedule

## Overview

This document outlines the maintenance schedule for StellarStream contracts and dependencies to ensure security, reliability, and compliance.

## Contract Audits

### Primary Contracts

| Contract | Version | Audit Frequency | Next Audit | Lead |
|----------|---------|-----------------|------------|------|
| splitter-v3 | v3.0 | Quarterly | 2026-09-27 | Security Team |
| splitter-factory | v1.0 | Semi-Annual | 2026-12-27 | Security Team |
| Contract-V2 | v2.0 | Quarterly | 2026-09-27 | Security Team |
| Contract-V1 | v1.0 | Annual | 2027-06-27 | Security Team |

### Audit Types

- **Quarterly Audits**: Full security audit including fuzz testing, invariant analysis, and manual review
- **Semi-Annual Audits**: Full security audit with external auditor engagement
- **Annual Audits**: Comprehensive audit including upgrade readiness assessment

### Pre-Audit Checklist

- [ ] Run all fuzz tests (`cargo fuzz run`)
- [ ] Execute invariant tests
- [ ] Review cross-contract interactions
- [ ] Update test coverage reports
- [ ] Verify no deprecated Soroban/Stellar functions in use
- [ ] Document all state changes since last audit

## Dependency Updates

### Smart Contract Dependencies (Rust)

| Dependency | Update Frequency | Responsible | Monitoring |
|------------|------------------|-------------|------------|
| soroban-sdk | Monthly | Core Team | GitHub Releases |
| stellar-rcp | Monthly | Core Team | GitHub Releases |

### Frontend Dependencies (Node.js)

| Dependency | Update Frequency | Responsible | Monitoring |
|------------|------------------|-------------|------------|
| next | Monthly | Frontend Team | GitHub Releases |
| react/react-dom | Monthly | Frontend Team | GitHub Releases |
| All dependencies | Bi-Weekly | Frontend Team | `npm audit` |

### Update Schedule

- **Monthly**: Review and update Soroban SDK and all Rust dependencies
- **Bi-Weekly**: `npm outdated` check and update frontend dependencies
- **Weekly**: Security audit check via `npm audit` and `cargo audit`

## Calendar Reminders

### Recurring Events

| Frequency | Task | Lead | Reminder |
|-----------|------|------|----------|
| Weekly (Friday) | Security scan: `cargo audit && npm audit` | Core Team | Calendar + Slack |
| Bi-Weekly (Monday) | Dependency review and updates | Frontend/Core Team | Calendar |
| Monthly (1st) | Rust dependency updates | Core Team | Calendar |
| Quarterly (Jan/Apr/Jul/Oct) | Contract security audits | Security Team | Calendar + Email |
| Annual (Dec) | Comprehensive audit and planning | Security Team | Calendar + Meeting |

### Calendar Configuration

Add these recurring events to the team calendar:

1. **Weekly Security Scan** - Every Friday 10:00 AM
2. **Bi-Weekly Dependency Review** - Every other Monday 9:00 AM
3. **Monthly Rust Updates** - 1st of each month 11:00 AM
4. **Quarterly Audit Prep** - 2 weeks before each quarter ends

## Responsibilities

### Core Team (Contract Development)

- **Primary**: Implement updates and fixes from audit findings
- **Secondary**: Run monthly Rust dependency updates
- **Tertiary**: Maintain test coverage and documentation

### Security Team

- **Primary**: Conduct quarterly and annual security audits
- **Secondary**: Monitor vulnerability disclosures
- **Tertiary**: Coordinate with external auditors

### Frontend Team

- **Primary**: Bi-weekly dependency updates
- **Secondary**: Monitor npm security advisories
- **Tertiary**: Update frontend integration tests

## Automated Checks

### CI Integration

```yaml
# Recommended CI checks to add:
- cargo audit (daily via cron workflow)
- npm audit (daily via cron workflow)
- Test coverage threshold (must pass)
- Fuzz test execution (weekly)
```

### Monitoring Commands

```bash
# Security scans
cargo audit
npm audit --audit-level high

# Dependency checks
cargo outdated
npm outdated

# Test execution
cargo test
cargo fuzz run --all
jest --coverage
```

## After Each Audit

1. Document findings in `audits/YYYY-MM-DD-audit-findings.md`
2. Create GitHub issues for each finding
3. Assign issues to responsible team members
4. Update this schedule with any changes
5. Schedule follow-up review within 30 days

## Escalation Process

- **Critical vulnerabilities**: Immediate patch within 24 hours
- **High severity**: Patch within 7 days
- **Medium severity**: Patch within 30 days
- **Low severity**: Patch within 90 days

---

*Last updated: 2026-06-27*