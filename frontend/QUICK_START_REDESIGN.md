# Quick Start: Frontend Redesign

## What's New

The entire StellarStream frontend has been redesigned with modern architecture:

- ✅ Route groups for organized pages
- ✅ Sidebar dashboard layout
- ✅ Authentication pages (login, signup, verify)
- ✅ Reusable component library
- ✅ Dashboard widgets, charts, tables, forms
- ✅ Professional glass-morphism design
- ✅ Full TypeScript support

## Directory Changes

### Old Structure
```
app/
├── dashboard/
│   └── ...
├── verify/
├── onboarding/
└── page.tsx
```

### New Structure
```
app/
├── (auth)/              <- New: Auth routes
│   ├── login/
│   ├── signup/
│   └── confirm-email/
├── (dashboard)/         <- New: Dashboard routes
│   ├── page.tsx
│   ├── streams/
│   ├── create-stream/
│   └── settings/
├── onboarding/
├── verify/
└── page.tsx
```

## Key Concepts

### Route Groups
Routes are organized by feature using parentheses:
- `(auth)` - Authentication pages
- `(dashboard)` - Protected dashboard pages
- `(marketing)` - Landing and public pages

### Component Organization
```
components/dashboard/
├── widgets/         <- Reusable cards and displays
├── charts/         <- Data visualizations
├── tables/         <- Data tables
└── forms/          <- Reusable forms
```

## Using Components

### UI Components
```tsx
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

export default function MyPage() {
  return (
    <Card className="glass-card p-6">
      <Button>Click me</Button>
      <Input placeholder="Type here..." />
    </Card>
  );
}
```

### Dashboard Widgets
```tsx
import { StatsCard, StreamCard } from '@/components/dashboard/widgets';

export default function Dashboard() {
  return (
    <div className="grid grid-cols-4 gap-6">
      <StatsCard 
        title="Total Streams"
        value={42}
        trend="up"
        trendValue="+5 this month"
      />
    </div>
  );
}
```

### Dashboard Forms
```tsx
import { CreateStreamForm } from '@/components/dashboard/forms';

export default function CreateStreamPage() {
  return (
    <CreateStreamForm
      onSubmit={async (data) => {
        // Handle form submission
      }}
    />
  );
}
```

### Dashboard Tables
```tsx
import { StreamsTable } from '@/components/dashboard/tables';

export default function StreamsPage() {
  return (
    <StreamsTable
      streams={[
        {
          id: '1',
          title: 'Monthly Payment',
          recipient: 'GXXX...',
          amount: '1000',
          asset: 'USDC',
          status: 'active',
          createdAt: new Date(),
        },
      ]}
    />
  );
}
```

## Page Templates

### Dashboard Page
```tsx
'use client';

import { Card } from '@/components/ui/Card';
import { StatsCard } from '@/components/dashboard/widgets';

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-heading text-4xl font-bold">Dashboard</h1>
        <p className="text-white/60">Welcome back</p>
      </div>

      <div className="grid grid-cols-4 gap-6">
        <StatsCard
          title="Total Streams"
          value={0}
          subtitle="0 active"
        />
      </div>
    </div>
  );
}
```

### Settings Page
```tsx
'use client';

import { useState } from 'react';
import { SettingsForm } from '@/components/dashboard/forms';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'profile' | 'security'>('profile');

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-heading text-4xl font-bold">Settings</h1>
      </div>

      <div className="flex gap-4 border-b border-white/10">
        {['profile', 'security'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as any)}
            className={`px-4 py-3 capitalize ${
              activeTab === tab
                ? 'border-b-2 border-cyan-500'
                : ''
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'profile' && (
        <SettingsForm onSubmit={async (data) => {
          // Handle settings update
        }} />
      )}
    </div>
  );
}
```

## Styling Guide

### CSS Classes

**Glass Card**
```tsx
<div className="glass-card p-6">
  Content
</div>
```

**Buttons**
```tsx
// Primary
<button className="bg-cyan-500 hover:bg-cyan-600 text-black font-semibold px-4 py-2 rounded-lg">
  Click me
</button>

// Outline
<button className="border border-white/20 hover:bg-white/5 px-4 py-2 rounded-lg">
  Click me
</button>
```

**Grid Layouts**
```tsx
// 4-column grid on large, 2 on medium, 1 on small
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
  {/* Cards */}
</div>
```

**Status Colors**
```tsx
// Success
<span className="text-green-400">Active</span>

// Warning
<span className="text-yellow-400">Paused</span>

// Error
<span className="text-red-400">Failed</span>

// Info
<span className="text-cyan-400">Pending</span>
```

## Common Patterns

### Loading State
```tsx
import { Suspense } from 'react';
import { Spinner } from '@/components/ui/Spinner';

function Content() {
  return <div>Loaded content</div>;
}

export default function Page() {
  return (
    <Suspense fallback={<Spinner />}>
      <Content />
    </Suspense>
  );
}
```

### Error State
```tsx
export default function Page() {
  const [error, setError] = useState('');

  return (
    <>
      {error && (
        <div className="glass-card p-4 bg-red-500/10 border border-red-500/30">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}
      {/* Content */}
    </>
  );
}
```

### Form Submission
```tsx
const [isLoading, setIsLoading] = useState(false);

const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setIsLoading(true);
  try {
    // Submit logic
  } catch (err) {
    // Handle error
  } finally {
    setIsLoading(false);
  }
};
```

## Migration from Old Pages

### Old Route → New Route
| Old | New |
|-----|-----|
| `/dashboard` | `/dashboard` |
| `/dashboard/settings` | `/settings` |
| Direct `/verify` | Stays at `/verify` |
| `/onboarding` | `/onboarding` |

### Old Component → New Pattern
```tsx
// Old: Direct page layout with sidebar
<Sidebar />
<Content>...</Content>

// New: Inherited from (dashboard)/layout.tsx
<DashboardShell>{children}</DashboardShell>
```

## Adding New Pages

### Add Dashboard Page
1. Create folder: `app/(dashboard)/my-feature/`
2. Add file: `page.tsx`
3. Inherits dashboard layout automatically

```tsx
// app/(dashboard)/my-feature/page.tsx
export default function MyFeaturePage() {
  return (
    <div className="space-y-8">
      <h1 className="font-heading text-4xl font-bold">My Feature</h1>
      {/* Content */}
    </div>
  );
}
```

### Add Auth Page
1. Create folder: `app/(auth)/my-auth-page/`
2. Add file: `page.tsx`
3. Inherits centered auth layout

```tsx
// app/(auth)/my-auth-page/page.tsx
export default function MyAuthPage() {
  return (
    <div className="space-y-6">
      <h1>My Auth Page</h1>
      {/* Content */}
    </div>
  );
}
```

### Add New Component
1. Create in `components/dashboard/my-widget/`
2. Export from index.ts
3. Import and use

```tsx
// components/dashboard/my-widget/MyWidget.tsx
export default function MyWidget() {
  return <div>My widget</div>;
}

// components/dashboard/my-widget/index.ts
export { default as MyWidget } from './MyWidget';

// Usage in pages
import { MyWidget } from '@/components/dashboard';
```

## Type Safety

All components have full TypeScript support:

```tsx
interface MyCardProps {
  title: string;
  value: number | string;
  trend?: 'up' | 'down';
}

export default function MyCard({
  title,
  value,
  trend,
}: MyCardProps) {
  return <div>{title}: {value}</div>;
}
```

## Navigation

### Link Components
```tsx
import Link from 'next/link';

<Link href="/dashboard">
  <button className="...">Dashboard</button>
</Link>
```

### Internal Routes
- `/` - Landing
- `/login` - Login
- `/signup` - Sign up
- `/confirm-email` - Email verification
- `/dashboard` - Dashboard home
- `/streams` - Streams list
- `/create-stream` - Create stream
- `/settings` - Settings
- `/onboarding` - Onboarding
- `/verify` - Stream verification

## Debugging

### Check Console
```bash
npm run dev
# Open browser console for TypeScript/build errors
```

### Common Issues

**Missing component export**
```tsx
// Fix: Add to components/dashboard/index.ts
export { default as MyComponent } from './my-component/MyComponent';
```

**Wrong import path**
```tsx
// Wrong
import { Component } from '../components/my-component';

// Right
import { Component } from '@/components/my-component';
```

**Missing TypeScript types**
```tsx
// Wrong
function MyComponent(props) { }

// Right
interface MyComponentProps {
  title: string;
}

function MyComponent({ title }: MyComponentProps) { }
```

## Resources

- Architecture Guide: `FRONTEND_REDESIGN_ARCHITECTURE.md`
- Complete Summary: `REDESIGN_SUMMARY.md`
- This Quick Start: `QUICK_START_REDESIGN.md`

## Support

For questions about:
- **Routes**: See route groups in `app/`
- **Components**: Check `components/dashboard/`
- **Styling**: Review `app/globals.css`
- **Types**: Check component interfaces
- **Examples**: Look at existing pages

---

**Happy coding! The new architecture makes it easy to build and maintain the StellarStream frontend.** 🚀
