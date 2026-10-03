import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import TimeField from './TimeField.svelte';

describe('TimeField', () => {
	it('shows a formatted value and commits parsed input', async () => {
		const onCommit = vi.fn();
		const screen = await render(TimeField, {
			label: 'Start',
			seconds: 12.3,
			onCommit,
			testid: 'tf'
		});
		const input = screen.container.querySelector('[data-testid="tf"]') as HTMLInputElement;
		expect(input.value).toBe('00:12.3');

		input.value = '15.5';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(onCommit).toHaveBeenCalledWith(15.5);
	});

	it('rejects invalid input without committing', async () => {
		const onCommit = vi.fn();
		const screen = await render(TimeField, { label: 'Start', seconds: 1, onCommit, testid: 'tf' });
		const input = screen.container.querySelector('[data-testid="tf"]') as HTMLInputElement;
		input.value = 'abc';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(onCommit).not.toHaveBeenCalled();
		await expect.poll(() => input.className).toContain('input-error');
	});
});
