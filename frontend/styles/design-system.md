# StellarStream Design System

A comprehensive design system for building consistent, maintainable user interfaces across the StellarStream frontend application.

## Table of Contents

1. [Color System](#color-system)
2. [Typography](#typography)
3. [Spacing & Layout](#spacing--layout)
4. [Components](#components)
5. [Usage Guidelines](#usage-guidelines)

---

## Color System

### Primary Colors

The primary color palette is used for main interactive elements, buttons, and brand-critical UI.

- **Primary-500**: Main action color (e.g., buttons, links)
- **Primary-600**: Hover state
- **Primary-700**: Active/pressed state

### Secondary Colors

For secondary actions, accents, and supporting interactive elements.

### Status Colors

- **Success** (Green): Confirmations, successful operations, positive states
- **Warning** (Amber): Cautions, warnings, attention-needed states
- **Error** (Red): Errors, failures, destructive actions
- **Info** (Blue): Informational messages, neutral states

### Neutral Colors

Grays used for text, backgrounds, borders, and disabled states.

- **Neutral-900**: Primary text
- **Neutral-700**: Secondary text
- **Neutral-600**: Tertiary text, placeholders
- **Neutral-400**: Disabled states, borders
- **Neutral-200**: Subtle backgrounds
- **Neutral-50**: Light backgrounds

### Color Usage Rules

1. Never hardcode colors; always use design tokens
2. Use semantic color names (success, error) over generic names (green, red)
3. Ensure sufficient contrast (WCAG AA minimum 4.5:1 for text)
4. Support dark mode by using neutral variants

---

## Typography

### Font Stack

```css
font-family: 'Poppins', 'Lato', system-ui, sans-serif;
```

### Headings

| Level | Size | Weight | Line Height | Use Case |
|-------|------|--------|-------------|----------|
| H1 | 2.5rem (40px) | 700 | 3rem | Page titles |
| H2 | 2rem (32px) | 700 | 2.5rem | Section titles |
| H3 | 1.5rem (24px) | 600 | 2rem | Subsection titles |
| H4 | 1.25rem (20px) | 600 | 1.75rem | Component titles |

### Body Text

| Level | Size | Weight | Line Height | Use Case |
|-------|------|--------|-------------|----------|
| Body LG | 1.125rem (18px) | 400 | 1.75rem | Large body text |
| Body MD | 1rem (16px) | 400 | 1.5rem | Standard body text |
| Body SM | 0.875rem (14px) | 400 | 1.25rem | Secondary text |
| Body XS | 0.75rem (12px) | 400 | 1rem | Captions, metadata |

### Typography Classes

```tsx
// Use semantic component names
<H1>Main Title</H1>
<Heading level={2}>Section Title</Heading>
<Paragraph size="lg">Large paragraph</Paragraph>
<Caption>Small caption text</Caption>
```

### Typography Guidelines

1. Maintain hierarchy with size and weight
2. Use line-height ≥ 1.5 for body text (accessibility)
3. Limit font sizes to defined scale
4. Ensure sufficient contrast for text visibility
5. Use font weights: 400 (regular), 500 (medium), 600 (semibold), 700 (bold)

---

## Spacing & Layout

### Spacing Scale

| Token | Size | Use Case |
|-------|------|----------|
| xs | 0.25rem (4px) | Micro spacing, tight density |
| sm | 0.5rem (8px) | Compact spacing, small gaps |
| md | 1rem (16px) | Standard spacing, default gaps |
| lg | 1.5rem (24px) | Comfortable spacing, sections |
| xl | 2rem (32px) | Large gaps, major sections |
| 2xl | 2.5rem (40px) | Extra large gaps |
| 3xl | 3rem (48px) | Hero sections, page margins |

### Spacing Usage

```tsx
// Always use tokens, never hardcode
<div className="p-md">    {/* padding: 1rem */}
<div className="m-lg">    {/* margin: 1.5rem */}
<div className="gap-md">  {/* gap: 1rem */}
```

### Grid Layout

- **Base unit**: 1rem (16px)
- **Max width**: 1280px (lg breakpoint)
- **Columns**: 12-column grid for consistency
- **Gutter**: md (1rem) default

### Responsive Breakpoints

| Name | Width | Device Type |
|------|-------|------------|
| xs | 320px | Mobile small |
| sm | 640px | Mobile large |
| md | 768px | Tablet |
| lg | 1024px | Desktop |
| xl | 1280px | Desktop large |
| 2xl | 1536px | Desktop XL |

---

## Components

### Base Components

Base components are the foundational building blocks of the UI.

#### Button

**Variants**: primary, secondary, ghost, outline
**Sizes**: sm, md, lg
**States**: default, hover, active, loading, disabled

```tsx
<Button variant="primary" size="md" onClick={handleClick}>
  Click me
</Button>
```

#### Card

Flexible container for content with consistent styling.

```tsx
<Card className="p-lg">
  <h3>Card Title</h3>
  <p>Card content</p>
</Card>
```

#### Input

Form input with validation states and icons.

```tsx
<Input
  type="text"
  placeholder="Enter value"
  error="Field is required"
  icon={<SearchIcon />}
/>
```

#### Modal

Dialog overlay for focused interactions.

```tsx
<Modal open={isOpen} onClose={close}>
  <Modal.Header>Title</Modal.Header>
  <Modal.Body>Content</Modal.Body>
  <Modal.Footer>
    <Button>Cancel</Button>
    <Button variant="primary">Confirm</Button>
  </Modal.Footer>
</Modal>
```

#### Badge

Status indicator with color variants.

```tsx
<Badge variant="success">Active</Badge>
<Badge variant="warning">Pending</Badge>
<Badge variant="error">Failed</Badge>
```

### Layout Components

#### Container

Responsive max-width container.

```tsx
<Container>
  <h1>Page content</h1>
</Container>
```

#### Stack

Flexible flexbox wrapper for spacing and alignment.

```tsx
<Stack spacing="md" direction="column">
  <div>Item 1</div>
  <div>Item 2</div>
</Stack>
```

#### Grid

CSS Grid wrapper for complex layouts.

```tsx
<Grid columns="auto 1fr auto" gap="md">
  <Sidebar />
  <Main />
  <Aside />
</Grid>
```

### Feature Components

#### StreamCard

Display stream information and actions.

```tsx
<StreamCard
  stream={streamData}
  onView={handleView}
  onArchive={handleArchive}
/>
```

#### TransactionTable

Tabular display of transaction data.

```tsx
<TransactionTable
  data={transactions}
  onSort={handleSort}
  pagination={pageInfo}
/>
```

---

## Usage Guidelines

### DO's ✓

- Use design tokens consistently
- Follow semantic HTML structure
- Test accessibility (keyboard nav, screen readers)
- Maintain visual hierarchy
- Use components as building blocks
- Document component changes
- Keep components single-responsibility

### DON'Ts ✗

- Hardcode colors, spacing, or sizing
- Mix component libraries
- Violate spacing scale
- Create one-off component styles
- Ignore accessibility requirements
- Skip prop validation
- Use `!important` in styles

### Accessibility Checklist

- [ ] Color is not the only differentiator
- [ ] Keyboard navigation works
- [ ] Focus states are visible
- [ ] Semantic HTML is used
- [ ] Images have alt text
- [ ] Forms have labels
- [ ] Contrast ratio ≥ 4.5:1
- [ ] Touch targets ≥ 44x44px

### Dark Mode

All components must support both light and dark modes.

```tsx
// Use CSS variables that switch with color-scheme
<div className="bg-neutral-50 dark:bg-neutral-900">
  Content adapts to theme
</div>
```

---

## Best Practices

### Component Composition

```tsx
// ✓ Good: Composable, flexible
<Card>
  <Card.Header>Title</Card.Header>
  <Card.Body>Content</Card.Body>
  <Card.Footer>Footer</Card.Footer>
</Card>

// ✗ Poor: Monolithic, inflexible
<ComplexCard title="Title" body={content} footer={footer} />
```

### Prop Naming

```tsx
// ✓ Good: Clear intent
<Button variant="primary" size="lg" isLoading={true}>

// ✗ Poor: Ambiguous
<Button primary large loading>
```

### Documentation

```tsx
/**
 * A reusable button component
 * @param variant - Button style: 'primary' | 'secondary' | 'ghost'
 * @param size - Button size: 'sm' | 'md' | 'lg'
 * @param disabled - Disable the button
 * @param children - Button content
 */
export const Button = ({ variant, size, disabled, children }) => {
  // Implementation
};
```

---

## Maintenance

### Adding New Tokens

1. Add to `frontend/styles/design-tokens.ts`
2. Update this documentation
3. Update Tailwind config if needed
4. Create migration guide if breaking existing usage

### Component Updates

1. Follow SemVer for versioning
2. Document breaking changes
3. Update examples and documentation
4. Test with real-world usage
5. Get peer review before merging

### Deprecation

When deprecating:

1. Add `@deprecated` JSDoc comment
2. Provide migration path
3. Keep for 2+ releases
4. Document in CHANGELOG
5. Update all internal usage

---

## Resources

- [Tailwind CSS Documentation](https://tailwindcss.com)
- [Lucide Icons](https://lucide.dev)
- [Radix UI Components](https://radix-ui.com)
- [Web Accessibility (WCAG)](https://www.w3.org/WAI/WCAG21/quickref/)

---

**Last Updated**: 2024
**Version**: 1.0
