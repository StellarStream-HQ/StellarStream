'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface ModalProps extends React.HTMLAttributes<HTMLDivElement> {
  open: boolean;
  onClose: () => void;
  onOpenChange?: (open: boolean) => void;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
}

interface ModalComponent extends React.ForwardRefExoticComponent<ModalProps & React.RefAttributes<HTMLDivElement>> {
  Header: typeof ModalHeader;
  Body: typeof ModalBody;
  Footer: typeof ModalFooter;
}

/**
 * Modal component - dialog overlay for focused interactions
 * @example
 * <Modal open={isOpen} onClose={() => setIsOpen(false)}>
 *   <Modal.Header>Title</Modal.Header>
 *   <Modal.Body>Content</Modal.Body>
 *   <Modal.Footer>Footer</Modal.Footer>
 * </Modal>
 */
const ModalBase = React.forwardRef<HTMLDivElement, ModalProps>(
  (
    {
      open,
      onClose,
      onOpenChange,
      size = 'md',
      closeOnBackdrop = true,
      closeOnEscape = true,
      className,
      children,
      ...props
    },
    ref
  ) => {
    React.useEffect(() => {
      if (!open) return;

      const handleEscape = (e: KeyboardEvent) => {
        if (closeOnEscape && e.key === 'Escape') {
          onClose();
          onOpenChange?.(false);
        }
      };

      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';

      return () => {
        document.removeEventListener('keydown', handleEscape);
        document.body.style.overflow = 'unset';
      };
    }, [open, onClose, onOpenChange, closeOnEscape]);

    if (!open) return null;

    const sizeMap = {
      sm: 'max-w-sm',
      md: 'max-w-md',
      lg: 'max-w-lg',
      xl: 'max-w-xl',
    };

    const handleBackdropClick = () => {
      if (closeOnBackdrop) {
        onClose();
        onOpenChange?.(false);
      }
    };

    return (
      <>
        {/* Backdrop */}
        <div
          className="fixed inset-0 z-40 bg-black/50 transition-opacity"
          onClick={handleBackdropClick}
          role="presentation"
        />

        {/* Modal */}
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            ref={ref}
            className={cn(
              'w-full bg-white rounded-lg shadow-xl',
              'transform transition-all',
              sizeMap[size],
              className
            )}
            {...props}
          >
            {children}
          </div>
        </div>
      </>
    );
  }
);

ModalBase.displayName = 'Modal';

/**
 * Modal header component
 */
interface ModalHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  onClose?: () => void;
  showCloseButton?: boolean;
}

export const ModalHeader = React.forwardRef<HTMLDivElement, ModalHeaderProps>(
  ({ onClose, showCloseButton = true, className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-center justify-between p-6 border-b border-neutral-200', className)}
      {...props}
    >
      <div>{children}</div>
      {showCloseButton && onClose && (
        <button
          onClick={onClose}
          className="text-neutral-500 hover:text-neutral-700 transition-colors"
          aria-label="Close modal"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
);

ModalHeader.displayName = 'ModalHeader';

/**
 * Modal body component
 */
export const ModalBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-6', className)} {...props} />
  )
);

ModalBody.displayName = 'ModalBody';

/**
 * Modal footer component
 */
interface ModalFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: 'left' | 'center' | 'right';
}

export const ModalFooter = React.forwardRef<HTMLDivElement, ModalFooterProps>(
  ({ align = 'right', className, ...props }, ref) => {
    const alignMap = {
      left: 'justify-start',
      center: 'justify-center',
      right: 'justify-end',
    };

    return (
      <div
        ref={ref}
        className={cn('flex gap-3 p-6 border-t border-neutral-200', alignMap[align], className)}
        {...props}
      />
    );
  }
);

ModalFooter.displayName = 'ModalFooter';

// Compound component pattern
export const Modal = ModalBase as ModalComponent;
Modal.Header = ModalHeader;
Modal.Body = ModalBody;
Modal.Footer = ModalFooter;
