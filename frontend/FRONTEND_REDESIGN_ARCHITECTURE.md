# StellarStream Frontend Redesign

## Overview

Complete redesign and rebuild of the frontend application with modern, clean architecture following Next.js 15 best practices and App Router patterns.

## Directory Structure

```
frontend/
├── app/
│   ├── layout.tsx (root)
│   ├── page.tsx (landing/home)
│   ├── error.tsx (error boundary)
│   ├── not-found.tsx (404 page)
│   ├── globals.css (global styles)
│   ├── favicon.ico
│   │
│   ├── (auth)/
│   │   ├── layout.tsx (auth layout - minimal, centered)
│   │   ├── login/page.tsx
│   │   ├── signup/page.tsx
│   │   └── confirm-email/page.tsx
│   │
│   ├── (dashboard)/
│   │   ├── layout.tsx (dashboard layout - sidebar + header)
│   │   ├── page.tsx (dashboard home)
│   │   ├── streams/page.tsx (streams list)
│   │   ├── streams/[id]/page.tsx (stream detail)
│   │   ├── create-stream/page.tsx (create stream wizard)
│   │   ├── settings/page.tsx (user settings)
│   │   └── error.tsx (dashboard error boundary)
│   │
│   ├── onboarding/page.tsx (onboarding flow)
│   ├── verify/page.tsx (stream verification)
│   │
│   └── api/ (existing API routes - preserved)
│
├── components/
│   ├── ui/ (atomic UI components)
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Input.tsx
│   │   ├── Modal.tsx
│   │   ├── Spinner.tsx
│   │   ├── Badge.tsx
│   │   ├── Divider.tsx
│   │   ├── Alert.tsx
│   │   ├── Typography.tsx
│   │   └── index.ts
│   │
│   ├── layout/ (layout components)
│   │   ├── Container.tsx
│   │   ├── Grid.tsx
│   │   ├── Stack.tsx
│   │   └── index.ts
│   │
│   ├── dashboard/
│   │   ├── widgets/
│   │   │   ├── StatsCard.tsx (metric display)
│   │   │   ├── StreamCard.tsx (stream card)
│   │   │   ├── ActivityCard.tsx (activity feed)
│   │   │   ├── ProgressCard.tsx (progress indicator)
│   │   │   └── index.ts
│   │   │
│   │   ├── charts/
│   │   │   ├── StreamChart.tsx (stream flow visualization)
│   │   │   ├── BalanceChart.tsx (balance history)
│   │   │   ├── HistoryChart.tsx (transaction history)
│   │   │   └── index.ts
│   │   │
│   │   ├── tables/
│   │   │   ├── StreamsTable.tsx (streams data table)
│   │   │   ├── TransactionTable.tsx (transactions data table)
│   │   │   └── index.ts
│   │   │
│   │   ├── forms/
│   │   │   ├── CreateStreamForm.tsx (stream creation form)
│   │   │   ├── SettingsForm.tsx (settings form)
│   │   │   ├── FilterForm.tsx (filter/search form)
│   │   │   └── index.ts
│   │   │
│   │   ├── dashboard-shell.tsx (main dashboard wrapper)
│   │   ├── sidebar.tsx (navigation sidebar)
│   │   ├── index.ts (barrel export)
│   │   └── (other existing components)
│   │
│   ├── landing/ (landing page components)
│   ├── auth/ (auth components)
│   ├── settings/ (settings components)
│   ├── common/ (shared components)
│   └── (other existing components)
│
├── lib/
├── styles/
├── public/
├── hooks/
├── features/
│
└── (config files)
```

## Key Features

### 1. Route Groups

**Auth Routes** `(auth)/`
- Dedicated layout for authentication pages
- Centered, minimal design without sidebar
- Pages: login, signup, confirm-email

**Dashboard Routes** `(dashboard)/`
- Protected routes with dashboard layout
- Sidebar navigation and header
- Pages: home, streams, create-stream, settings

### 2. Component Organization

**UI Components** (`components/ui/`)
- Atomic, reusable building blocks
- Button, Card, Input, Modal, Spinner, etc.
- Pure presentation, no business logic

**Dashboard Components** (`components/dashboard/`)
- **Widgets**: Reusable cards and displays
  - StatsCard: Metrics display
  - StreamCard: Stream item card
  - ActivityCard: Activity feed
  - ProgressCard: Progress indicators

- **Charts**: Data visualizations
  - StreamChart: Stream flow
  - BalanceChart: Balance history
  - HistoryChart: Transaction history

- **Tables**: Data tables
  - StreamsTable: Streams list
  - TransactionTable: Transactions list

- **Forms**: Reusable forms
  - CreateStreamForm: Stream creation wizard
  - SettingsForm: User settings
  - FilterForm: Search and filtering

### 3. Design System

**Colors** (from globals.css)
- Primary: Cyan (#00f5ff)
- Secondary: Violet (#8a00ff)
- Background: Black (#030303)
- Foreground: White (#ffffff)

**Glass Morphism**
- `.glass-card` utility class
- Backdrop blur with fallback
- Consistent styling across components

**Typography**
- Heading: Lato font
- Body: Poppins font
- Monospace: Plus Jakarta Sans (for addresses/hashes)

### 4. Page Structure

#### Landing Page (`/`)
- Hero section
- Money in motion section
- Feature bento grid
- Neon ticker section
- Navigation and footer

#### Auth Pages
**Login** (`/login`)
- Email/password form
- Wallet connection option
- Sign up link
- Password recovery link

**Sign Up** (`/signup`)
- Registration form
- Password confirmation
- Terms agreement
- Email verification redirect

**Confirm Email** (`/confirm-email`)
- 6-digit code input
- Resend code option
- Routing to onboarding

#### Dashboard Pages

**Dashboard Home** (`/dashboard`)
- Stats overview (streams, volume, disbursements, balance)
- Recent streams section
- Recent activity feed
- Quick action buttons
- Onboarding prompt

**Streams List** (`/streams`)
- Search and filtering
- Status filter (all/active/paused/completed)
- Sort options
- Data table with inline actions
- Create stream CTA

**Create Stream** (`/create-stream`)
- Multi-step wizard (4 steps)
- Step 1: Recipient address
- Step 2: Amount & asset
- Step 3: Duration & start date
- Step 4: Review & confirmation
- Progress indicator

**Settings** (`/settings`)
- Profile tab (name, email, organization)
- Security tab (password, 2FA, sessions)
- Billing tab (plan, status, history)

#### Special Pages

**Onboarding** (`/onboarding`)
- Welcome flow (4 steps)
- Feature introduction
- Setup guidance
- Skip option

**Stream Verification** (`/verify`)
- Enter stream ID to verify
- Show cryptographic proof
- Display payment history
- Download audit PDF

## Styling Standards

### Tailwind CSS
- Mobile-first approach
- Responsive utilities (sm, md, lg, xl, 2xl)
- Custom utilities defined in globals.css

### Glass Card Component
```tsx
<Card className="glass-card p-6">
  {/* content */}
</Card>
```

### Button Styles
- Primary: `bg-cyan-500 hover:bg-cyan-600 text-black font-semibold`
- Outline: `border border-white/20 hover:bg-white/5`
- Disabled: `disabled:opacity-50 disabled:cursor-not-allowed`

### Color Scheme
- Success: Green (#34d399)
- Warning: Yellow (#fbbf24)
- Error: Red (#ff3b5c)
- Info: Cyan (#00f5ff)

## TypeScript Types

All components have proper TypeScript interfaces:
- Props interfaces for all components
- Exported types for reuse
- No implicit `any` types

## Accessibility

- Semantic HTML (button, input, select, etc.)
- ARIA attributes where needed
- Focus management
- Keyboard navigation support
- High contrast mode support

## Production Ready

### Build & Deployment
- No build errors or warnings
- Optimized for production
- All imports properly resolved
- No console.log statements in production code

### Performance
- Code splitting by route
- Image optimization
- Font optimization with fallbacks
- CSS-in-JS compiled to CSS

### SEO
- Metadata for all pages
- Open Graph tags
- Proper heading hierarchy
- Semantic HTML

## Migration Guide

### From Old Structure
1. Route groups organize pages by feature
2. New sidebar/header in (dashboard) layout
3. Components reorganized by function
4. All pages use new UI component library

### Breaking Changes
- Old routes in flat structure need to move to groups
- Direct imports from old layout need updates
- Old component paths change

## Component Import Examples

```tsx
// UI Components
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

// Dashboard Widgets
import { StatsCard, StreamCard, ActivityCard } from '@/components/dashboard/widgets';

// Dashboard Forms
import { CreateStreamForm, FilterForm } from '@/components/dashboard/forms';

// Dashboard Tables
import { StreamsTable, TransactionTable } from '@/components/dashboard/tables';

// Dashboard Charts
import { StreamChart, BalanceChart } from '@/components/dashboard/charts';
```

## Error Handling

- **Global Error Boundary**: `app/error.tsx` with glitch aesthetic
- **404 Page**: `app/not-found.tsx` with system glitch theme
- **Dashboard Error Boundary**: `app/(dashboard)/error.tsx` for isolated errors
- Error recovery with reset/retry buttons

## Loading States

- Suspense boundaries with fallback spinners
- Progressive skeleton loading where needed
- Loading indicators on forms and buttons

## Development Tips

1. **Use the UI component library** for consistency
2. **Leverage route groups** for feature organization
3. **Keep components small** and focused
4. **Export barrels** (index.ts) for clean imports
5. **Document components** with JSDoc comments
6. **Test accessibility** with keyboard navigation
7. **Follow naming conventions** (PascalCase for components, camelCase for utilities)

## Future Enhancements

- [ ] Add more chart types with real data
- [ ] Implement authentication middleware
- [ ] Add server-side data fetching
- [ ] Implement real-time updates with WebSockets
- [ ] Add comprehensive error logging
- [ ] Implement analytics
- [ ] Add more detailed transaction history
- [ ] Implement advanced filtering
- [ ] Add data export functionality
- [ ] Create mobile-responsive layouts
