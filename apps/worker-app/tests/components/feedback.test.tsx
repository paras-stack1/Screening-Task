import { fireEvent, screen } from '@testing-library/react-native';
import {
  ConfirmationDialog,
  EmptyState,
  ErrorState,
  LoadingIndicator,
  StatusBadge,
} from '../../src/components';
import { renderWithProviders } from '../utils/render';

describe('LoadingIndicator', () => {
  it('has a translated default label announced as busy progress', async () => {
    await renderWithProviders(<LoadingIndicator />, { language: 'hi' });
    const indicator = screen.getByRole('progressbar', { name: 'लोड हो रहा है…' });
    expect(indicator).toBeBusy();
  });

  it('accepts a custom label', async () => {
    await renderWithProviders(<LoadingIndicator label="Restoring your session" />);
    expect(screen.getByText('Restoring your session')).toBeOnTheScreen();
  });
});

describe('ErrorState', () => {
  it('shows safe default text and a retry button', async () => {
    const onRetry = jest.fn();
    await renderWithProviders(<ErrorState onRetry={onRetry} />);
    expect(screen.getByRole('header', { name: 'Something went wrong' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('blocks repeated retries while retrying', async () => {
    const onRetry = jest.fn();
    await renderWithProviders(<ErrorState onRetry={onRetry} retrying />);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('has no retry button when retry is not possible', async () => {
    await renderWithProviders(<ErrorState />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('EmptyState', () => {
  it('explains the empty state and offers the next action', async () => {
    const onPress = jest.fn();
    await renderWithProviders(
      <EmptyState
        title="No notifications"
        message="You are all caught up."
        action={{ label: 'Refresh', onPress }}
      />,
    );
    expect(screen.getByRole('header', { name: 'No notifications' })).toBeOnTheScreen();
    expect(screen.getByText('You are all caught up.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Refresh' }));
    expect(onPress).toHaveBeenCalled();
  });
});

describe('StatusBadge', () => {
  it('always carries a text label (never colour alone)', async () => {
    await renderWithProviders(<StatusBadge label="Offline" tone="danger" />);
    expect(screen.getByText('Offline')).toBeOnTheScreen();
  });
});

describe('ConfirmationDialog', () => {
  const base = { visible: true, title: 'Log out?', onConfirm: jest.fn(), onCancel: jest.fn() };

  it('confirms and cancels', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    await renderWithProviders(<ConfirmationDialog {...base} onConfirm={onConfirm} onCancel={onCancel} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('blocks a second confirmation and cancel while confirming', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    await renderWithProviders(
      <ConfirmationDialog {...base} confirming onConfirm={onConfirm} onCancel={onCancel} />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('renders nothing when hidden', async () => {
    await renderWithProviders(<ConfirmationDialog {...base} visible={false} />);
    expect(screen.queryByText('Log out?')).toBeNull();
  });
});
