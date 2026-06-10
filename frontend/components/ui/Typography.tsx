'use client';

import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Semantic typography components
 */

interface HeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
}

type HeadingTagType = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

export const Heading = React.forwardRef<HTMLHeadingElement, HeadingProps>(
  ({ level = 1, as, className, children, ...props }, ref) => {
    const HeadingTag = (as || `h${level}`) as HeadingTagType;

    const sizeStyles = {
      1: 'text-4xl font-bold',
      2: 'text-3xl font-bold',
      3: 'text-2xl font-semibold',
      4: 'text-xl font-semibold',
      5: 'text-lg font-semibold',
      6: 'text-base font-semibold',
    };

    return React.createElement(
      HeadingTag as any,
      {
        ref,
        className: cn(sizeStyles[level], 'text-neutral-900', className),
        ...props,
      },
      children
    );
  }
);

Heading.displayName = 'Heading';

// Convenience components
export const H1 = (props: React.HTMLAttributes<HTMLHeadingElement>) => (
  <Heading level={1} {...props} />
);
H1.displayName = 'H1';

export const H2 = (props: React.HTMLAttributes<HTMLHeadingElement>) => (
  <Heading level={2} {...props} />
);
H2.displayName = 'H2';

export const H3 = (props: React.HTMLAttributes<HTMLHeadingElement>) => (
  <Heading level={3} {...props} />
);
H3.displayName = 'H3';

export const H4 = (props: React.HTMLAttributes<HTMLHeadingElement>) => (
  <Heading level={4} {...props} />
);
H4.displayName = 'H4';

interface ParagraphProps extends React.HTMLAttributes<HTMLParagraphElement> {
  size?: 'lg' | 'md' | 'sm' | 'xs';
  muted?: boolean;
  truncate?: boolean;
}

export const Paragraph = React.forwardRef<HTMLParagraphElement, ParagraphProps>(
  ({ size = 'md', muted = false, truncate = false, className, ...props }, ref) => {
    const sizeStyles = {
      lg: 'text-lg',
      md: 'text-base',
      sm: 'text-sm',
      xs: 'text-xs',
    };

    return (
      <p
        ref={ref}
        className={cn(
          sizeStyles[size],
          'leading-relaxed',
          muted && 'text-neutral-600',
          !muted && 'text-neutral-900',
          truncate && 'truncate',
          className
        )}
        {...props}
      />
    );
  }
);

Paragraph.displayName = 'Paragraph';

interface CaptionProps extends React.HTMLAttributes<HTMLParagraphElement> {
  variant?: 'default' | 'muted' | 'accent';
  uppercase?: boolean;
}

export const Caption = React.forwardRef<HTMLParagraphElement, CaptionProps>(
  ({ variant = 'default', uppercase = false, className, ...props }, ref) => {
    const variantStyles = {
      default: 'text-neutral-600',
      muted: 'text-neutral-500',
      accent: 'text-sky-600 font-semibold',
    };

    return (
      <p
        ref={ref}
        className={cn(
          'text-xs leading-normal',
          variantStyles[variant],
          uppercase && 'uppercase tracking-wider font-medium',
          className
        )}
        {...props}
      />
    );
  }
);

Caption.displayName = 'Caption';

// Compound export
export const Typography = {
  Heading,
  H1,
  H2,
  H3,
  H4,
  Paragraph,
  Caption,
};
