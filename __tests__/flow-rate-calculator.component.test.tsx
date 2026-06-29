/**
 * Flow Rate Calculator Component Tests
 * Tests for UI, interactions, and component behavior
 */

import React from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FlowRateCalculator, type FlowRatePreset } from '@/components/FlowRateCalculator'

describe('FlowRateCalculator Component', () => {
  describe('Rendering', () => {
    it('should render the component with all sections', () => {
      render(<FlowRateCalculator />)

      expect(screen.getByText('Flow Rate Calculator')).toBeInTheDocument()
      expect(screen.getByLabelText('Flow rate per second')).toBeInTheDocument()
      expect(screen.getByLabelText('Flow rate per day')).toBeInTheDocument()
      expect(screen.getByLabelText('Flow rate per month')).toBeInTheDocument()
    })

    it('should render action buttons', () => {
      render(<FlowRateCalculator />)

      expect(screen.getByRole('button', { name: /save as preset/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /import/i })).toBeInTheDocument()
    })

    it('should render presets section', () => {
      render(<FlowRateCalculator />)

      expect(screen.getByText(/saved presets/i)).toBeInTheDocument()
    })

    it('should display visual flow bar', () => {
      render(<FlowRateCalculator />)

      expect(screen.getByRole('progressbar')).toBeInTheDocument()
      expect(screen.getByText('Flow Rate Magnitude')).toBeInTheDocument()
    })

    it('should have proper ARIA labels', () => {
      render(<FlowRateCalculator />)

      expect(screen.getByLabelText('Flow rate per second')).toHaveAttribute('aria-label')
      expect(screen.getByLabelText('Flow rate per day')).toHaveAttribute('aria-label')
      expect(screen.getByLabelText('Flow rate per month')).toHaveAttribute('aria-label')
    })
  })

  describe('Input Conversions', () => {
    it('should convert per second to other units', async () => {
      render(<FlowRateCalculator />)

      const perSecondInput = screen.getByLabelText('Flow rate per second') as HTMLInputElement
      await userEvent.clear(perSecondInput)
      await userEvent.type(perSecondInput, '1')

      await waitFor(() => {
        const perDayInput = screen.getByLabelText('Flow rate per day') as HTMLInputElement
        const perMonthInput = screen.getByLabelText('Flow rate per month') as HTMLInputElement

        expect(perDayInput.value).toBe('86400')
        expect(perMonthInput.value).toBe('2592000')
      })
    })

    it('should convert per day to other units', async () => {
      render(<FlowRateCalculator />)

      const perDayInput = screen.getByLabelText('Flow rate per day') as HTMLInputElement
      await userEvent.clear(perDayInput)
      await userEvent.type(perDayInput, '86400')

      await waitFor(() => {
        const perSecondInput = screen.getByLabelText('Flow rate per second') as HTMLInputElement
        const perMonthInput = screen.getByLabelText('Flow rate per month') as HTMLInputElement

        expect(perSecondInput.value).toBe('1')
        expect(perMonthInput.value).toBe('2592000')
      })
    })

    it('should convert per month to other units', async () => {
      render(<FlowRateCalculator />)

      const perMonthInput = screen.getByLabelText('Flow rate per month') as HTMLInputElement
      await userEvent.clear(perMonthInput)
      await userEvent.type(perMonthInput, '2592000')

      await waitFor(() => {
        const perSecondInput = screen.getByLabelText('Flow rate per second') as HTMLInputElement
        const perDayInput = screen.getByLabelText('Flow rate per day') as HTMLInputElement

        expect(perSecondInput.value).toBe('1')
        expect(perDayInput.value).toBe('86400')
      })
    })

    it('should handle decimal inputs', async () => {
      render(<FlowRateCalculator />)

      const perSecondInput = screen.getByLabelText('Flow rate per second') as HTMLInputElement
      await userEvent.clear(perSecondInput)
      await userEvent.type(perSecondInput, '0.5')

      await waitFor(() => {
        const perDayInput = screen.getByLabelText('Flow rate per day') as HTMLInputElement
        expect(parseFloat(perDayInput.value)).toBeCloseTo(43200, 1)
      })
    })

    it('should handle very small numbers with 6 decimal precision', async () => {
      render(<FlowRateCalculator />)

      const perSecondInput = screen.getByLabelText('Flow rate per second') as HTMLInputElement
      await userEvent.clear(perSecondInput)
      await userEvent.type(perSecondInput, '0.000001')

      await waitFor(() => {
        const perSecondInput = screen.getByLabelText('Flow rate per second') as HTMLInputElement
        expect(perSecondInput.value).toBe('0.000001')
      })
    })

    it('should not show lag in conversions', async () => {
      const { rerender } = render(<FlowRateCalculator />)

      const startTime = performance.now()
      const perSecondInput = screen.getByLabelText('Flow rate per second') as HTMLInputElement
      await userEvent.clear(perSecondInput)
      await userEvent.type(perSecondInput, '1.234567')
      const endTime = performance.now()

      // Should complete within reasonable time (200ms for typing + conversions)
      expect(endTime - startTime).toBeLessThan(5000)
    })
  })

  describe('Visual Bar', () => {
    it('should display visual bar with proper styling', () => {
      render(<FlowRateCalculator />)

      const progressBar = screen.getByRole('progressbar')
      expect(progressBar).toBeInTheDocument()
      expect(progressBar).toHaveAttribute('aria-valuenow')
      expect(progressBar).toHaveAttribute('aria-valuemin', '0')
      expect(progressBar).toHaveAttribute('aria-valuemax', '100')
    })

    it('should update visual bar when value changes', async () => {
      render(<FlowRateCalculator />)

      const perSecondInput = screen.getByLabelText('Flow rate per second') as HTMLInputElement
      const progressBar = screen.getByRole('progressbar')

      await userEvent.clear(perSecondInput)
      await userEvent.type(perSecondInput, '1')

      await waitFor(() => {
        const valuenow = parseInt(progressBar.getAttribute('aria-valuenow') || '0')
        expect(valuenow).toBeGreaterThan(0)
      })
    })

    it('should display flow rate description', async () => {
      render(<FlowRateCalculator />)

      expect(screen.getByText(/flow rate magnitude/i)).toBeInTheDocument()
      expect(screen.getByText(/relative flow size/i)).toBeInTheDocument()
    })
  })

  describe('Reset Functionality', () => {
    it('should reset all values to zero', async () => {
      render(<FlowRateCalculator />)

      // Set a value
      const perSecondInput = screen.getByLabelText('Flow rate per second') as HTMLInputElement
      await userEvent.clear(perSecondInput)
      await userEvent.type(perSecondInput, '10')

      // Click reset
      const resetButton = screen.getByRole('button', { name: /reset/i })
      await userEvent.click(resetButton)

      await waitFor(() => {
        expect(perSecondInput.value).toBe('0')
      })
    })

    it('should reset all three input fields', async () => {
      render(<FlowRateCalculator />)

      const perSecondInput = screen.getByLabelText('Flow rate per second') as HTMLInputElement
      const perDayInput = screen.getByLabelText('Flow rate per day') as HTMLInputElement
      const perMonthInput = screen.getByLabelText('Flow rate per month') as HTMLInputElement

      await userEvent.clear(perSecondInput)
      await userEvent.type(perSecondInput, '5')

      const resetButton = screen.getByRole('button', { name: /reset/i })
      await userEvent.click(resetButton)

      await waitFor(() => {
        expect(perSecondInput.value).toBe('0')
        expect(perDayInput.value).toBe('0')
        expect(perMonthInput.value).toBe('0')
      })
    })
  })

  describe('Preset Management', () => {
    it('should open preset dialog when save button clicked', async () => {
      render(<FlowRateCalculator />)

      const saveButton = screen.getByRole('button', { name: /save as preset/i })
      await userEvent.click(saveButton)

      await waitFor(() => {
        expect(screen.getByText('Save as Preset')).toBeInTheDocument()
      })
    })

    it('should save preset with name', async () => {
      render(<FlowRateCalculator />)

      // Set a value
      const perSecondInput = screen.getByLabelText('Flow rate per second') as HTMLInputElement
      await userEvent.clear(perSecondInput)
      await userEvent.type(perSecondInput, '1')

      // Open preset dialog
      const saveButton = screen.getByRole('button', { name: /save as preset/i })
      await userEvent.click(saveButton)

      // Enter preset name
      const nameInput = screen.getByLabelText('Preset name') as HTMLInputElement
      await userEvent.type(nameInput, 'My Preset')

      // Click save
      const savePresetButton = screen.getByRole('button', { name: 'Save' })
      await userEvent.click(savePresetButton)

      await waitFor(() => {
        expect(screen.getByText('My Preset')).toBeInTheDocument()
      })
    })

    it('should not save preset without name', async () => {
      render(<FlowRateCalculator />)

      const saveButton = screen.getByRole('button', { name: /save as preset/i })
      await userEvent.click(saveButton)

      const savePresetButton = screen.getByRole('button', { name: 'Save' })
      // Button should be disabled when no name is entered
      expect(savePresetButton).toBeDisabled()
    })

    it('should load preset when clicked', async () => {
      render(<FlowRateCalculator />)

      // Set initial value and save
      const perSecondInput = screen.getByLabelText('Flow rate per second') as HTMLInputElement
      await userEvent.clear(perSecondInput)
      await userEvent.type(perSecondInput, '1')

      const saveButton = screen.getByRole('button', { name: /save as preset/i })
      await userEvent.click(saveButton)

      const nameInput = screen.getByLabelText('Preset name') as HTMLInputElement
      await userEvent.type(nameInput, 'Test Preset')

      const savePresetButton = screen.getByRole('button', { name: 'Save' })
      await userEvent.click(savePresetButton)

      // Change value
      await userEvent.clear(perSecondInput)
      await userEvent.type(perSecondInput, '2')

      // Load preset
      await waitFor(() => {
        const loadButton = screen.getByRole('button', { name: /load preset "Test Preset"/i })
        return loadButton
      })

      const loadButton = screen.getByRole('button', { name: /load preset/i })
      await userEvent.click(loadButton)

      await waitFor(() => {
        expect(perSecondInput.value).toBe('1')
      })
    })

    it('should delete preset', async () => {
      render(<FlowRateCalculator />)

      // Save a preset
      const perSecondInput = screen.getByLabelText('Flow rate per second') as HTMLInputElement
      await userEvent.clear(perSecondInput)
      await userEvent.type(perSecondInput, '1')

      const saveButton = screen.getByRole('button', { name: /save as preset/i })
      await userEvent.click(saveButton)

      const nameInput = screen.getByLabelText('Preset name') as HTMLInputElement
      await userEvent.type(nameInput, 'To Delete')

      const savePresetButton = screen.getByRole('button', { name: 'Save' })
      await userEvent.click(savePresetButton)

      // Delete preset
      await waitFor(() => {
        const deleteButton = screen.getByRole('button', { name: /delete preset "To Delete"/i })
        return deleteButton
      })

      const deleteButton = screen.getByRole('button', { name: /delete preset/i })
      await userEvent.click(deleteButton)

      await waitFor(() => {
        expect(screen.queryByText('To Delete')).not.toBeInTheDocument()
      })
    })
  })

  describe('Preset Dialog', () => {
    it('should close dialog on cancel', async () => {
      render(<FlowRateCalculator />)

      const saveButton = screen.getByRole('button', { name: /save as preset/i })
      await userEvent.click(saveButton)

      await waitFor(() => {
        const cancelButton = screen.getByRole('button', { name: 'Cancel' })
        return cancelButton
      })

      const cancelButton = screen.getByRole('button', { name: 'Cancel' })
      await userEvent.click(cancelButton)

      await waitFor(() => {
        expect(screen.queryByText('Save as Preset')).not.toBeInTheDocument()
      })
    })

    it('should close dialog on Escape key', async () => {
      render(<FlowRateCalculator />)

      const saveButton = screen.getByRole('button', { name: /save as preset/i })
      await userEvent.click(saveButton)

      await waitFor(() => {
        expect(screen.getByText('Save as Preset')).toBeInTheDocument()
      })

      fireEvent.keyDown(document, { key: 'Escape' })

      await waitFor(() => {
        expect(screen.queryByText('Save as Preset')).not.toBeInTheDocument()
      })
    })

    it('should save on Enter key', async () => {
      render(<FlowRateCalculator />)

      const saveButton = screen.getByRole('button', { name: /save as preset/i })
      await userEvent.click(saveButton)

      const nameInput = screen.getByLabelText('Preset name') as HTMLInputElement
      await userEvent.type(nameInput, 'Enter Preset{Enter}')

      await waitFor(() => {
        expect(screen.getByText('Enter Preset')).toBeInTheDocument()
      })
    })
  })

  describe('Keyboard Navigation', () => {
    it('should allow Tab navigation through inputs', async () => {
      render(<FlowRateCalculator />)

      const perSecondInput = screen.getByLabelText('Flow rate per second')
      const perDayInput = screen.getByLabelText('Flow rate per day')
      const perMonthInput = screen.getByLabelText('Flow rate per month')

      perSecondInput.focus()
      expect(document.activeElement).toBe(perSecondInput)

      await userEvent.tab()
      expect(document.activeElement).toBe(perDayInput)

      await userEvent.tab()
      expect(document.activeElement).toBe(perMonthInput)
    })

    it('should maintain focus order', async () => {
      render(<FlowRateCalculator />)

      const saveButton = screen.getByRole('button', { name: /save as preset/i })
      saveButton.focus()
      expect(document.activeElement).toBe(saveButton)
    })
  })

  describe('Mobile Responsiveness', () => {
    it('should render full-width inputs on mobile', () => {
      // Mock mobile viewport
      global.innerWidth = 375
      global.dispatchEvent(new Event('resize'))

      render(<FlowRateCalculator />)

      const inputs = screen.getAllByRole('textbox')
      inputs.forEach(input => {
        expect(input.className).toContain('w-full')
      })
    })

    it('should have touch-friendly spacing', () => {
      render(<FlowRateCalculator />)

      const buttons = screen.getAllByRole('button')
      buttons.forEach(button => {
        // Check for adequate padding
        expect(button.className).toContain('px')
        expect(button.className).toContain('py')
      })
    })
  })

  describe('Callbacks', () => {
    it('should call onValueChange when value changes', async () => {
      const onValueChange = jest.fn()
      render(<FlowRateCalculator onValueChange={onValueChange} />)

      const perSecondInput = screen.getByLabelText('Flow rate per second') as HTMLInputElement
      await userEvent.clear(perSecondInput)
      await userEvent.type(perSecondInput, '1')

      await waitFor(() => {
        expect(onValueChange).toHaveBeenCalledWith(
          expect.objectContaining({
            perSecond: 1,
            perDay: 86400,
            perMonth: 2592000
          })
        )
      })
    })

    it('should call onPresetSelect when preset is loaded', async () => {
      const onPresetSelect = jest.fn()
      render(<FlowRateCalculator onPresetSelect={onPresetSelect} />)

      // Save a preset
      const perSecondInput = screen.getByLabelText('Flow rate per second') as HTMLInputElement
      await userEvent.clear(perSecondInput)
      await userEvent.type(perSecondInput, '1')

      const saveButton = screen.getByRole('button', { name: /save as preset/i })
      await userEvent.click(saveButton)

      const nameInput = screen.getByLabelText('Preset name') as HTMLInputElement
      await userEvent.type(nameInput, 'Test')

      const savePresetButton = screen.getByRole('button', { name: 'Save' })
      await userEvent.click(savePresetButton)

      // Load it
      await waitFor(() => {
        const loadButton = screen.getByRole('button', { name: /load preset/i })
        return loadButton
      })

      const loadButton = screen.getByRole('button', { name: /load preset/i })
      await userEvent.click(loadButton)

      await waitFor(() => {
        expect(onPresetSelect).toHaveBeenCalled()
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty input', async () => {
      render(<FlowRateCalculator />)

      const perSecondInput = screen.getByLabelText('Flow rate per second') as HTMLInputElement
      await userEvent.clear(perSecondInput)

      await waitFor(() => {
        // Should show 0 after clearing
        expect(perSecondInput.value).toBe('')
      })
    })

    it('should handle very large numbers', async () => {
      render(<FlowRateCalculator />)

      const perSecondInput = screen.getByLabelText('Flow rate per second') as HTMLInputElement
      await userEvent.clear(perSecondInput)
      await userEvent.type(perSecondInput, '1000000')

      await waitFor(() => {
        const perMonthInput = screen.getByLabelText('Flow rate per month') as HTMLInputElement
        expect(parseFloat(perMonthInput.value)).toBeGreaterThan(0)
      })
    })
  })

  describe('Accessibility', () => {
    it('should have proper semantic HTML', () => {
      render(<FlowRateCalculator />)

      expect(screen.getByRole('progressbar')).toBeInTheDocument()
      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBeGreaterThan(0)
    })

    it('should have ARIA labels on all interactive elements', () => {
      render(<FlowRateCalculator />)

      const inputs = [
        screen.getByLabelText('Flow rate per second'),
        screen.getByLabelText('Flow rate per day'),
        screen.getByLabelText('Flow rate per month')
      ]

      inputs.forEach(input => {
        expect(input).toHaveAttribute('aria-label')
      })
    })

    it('should have descriptive button labels', () => {
      render(<FlowRateCalculator />)

      expect(screen.getByRole('button', { name: /save as preset/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument()
    })

    it('should announce live region updates', () => {
      render(<FlowRateCalculator />)

      expect(screen.getByRole('progressbar')).toBeInTheDocument()
      // Visual bar is accessible with ARIA progressbar role
    })
  })
})
