'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'elevated' | 'outlined' | 'interactive';
  padding?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  hover?: boolean;
}

interface CardComponent extends React.ForwardRefExoticComponent<CardProps & React.RefAttributes<HTMLDivElement>> {
  Header: typeof CardHeader;
  Body: typeof CardBody;
  Footer: typeof CardFooter;
}

/**
 * Card component - flexible container for content
 * @example
 * <Card className="p-lg">
 *   <Card.Header>Title</Card.Header>
 *   <Card.Body>Content</Card.Body>
 * </Card>
 */
const CardBase = React.forwardRef<HTMLDivElement, CardProps>(
  ({ variant = 'default', padding = 'md', hover = false, className, children, ...props }, ref) => {
    const paddingMap = {
      xs: 'p-1',
      sm: 'p-2',
      md: 'p-4',
      lg: 'p-6',
      xl: 'p-8',
    };

    const variantStyles = {
      default: 'bg-white border border-neutral-200 rounded-lg',
      elevated: 'bg-white rounded-lg shadow-md',
      outlined: 'bg-neutral-50 border-2 border-neutral-300 rounded-lg',
      interactive: 'bg-white border border-neutral-200 rounded-lg cursor-pointer transition-all duration-200 hover:shadow-lg hover:border-neutral-300',
    };

    const hoverStyles = hover
      ? 'transition-all duration-200 hover:shadow-lg hover:border-neutral-300 hover:bg-neutral-50'
      : '';

    return (
      <div
        ref={ref}
        className={cn(variantStyles[variant], paddingMap[padding], hoverStyles, className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);

CardBase.displayName = 'Card';

/**
 * Card header component
 */
interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  divider?: boolean;
}

export const CardHeader = React.forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ divider = true, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('mb-4 pb-4', divider && 'border-b border-neutral-200', className)}
      {...props}
    />
  )
);

CardHeader.displayName = 'CardHeader';

/**
 * Card body component
 */
export const CardBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('', className)} {...props} />
);

CardBody.displayName = 'CardBody';

/**
 * Card footer component
 */
interface CardFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  divider?: boolean;
}

export const CardFooter = React.forwardRef<HTMLDivElement, CardFooterProps>(
  ({ divider = true, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('mt-4 pt-4', divider && 'border-t border-neutral-200', className)}
      {...props}
    />
  )
);

CardFooter.displayName = 'CardFooter';

// Compound component pattern
export const Card = CardBase as CardComponent;
Card.Header = CardHeader;
Card.Body = CardBody;
Card.Footer = CardFooter;
