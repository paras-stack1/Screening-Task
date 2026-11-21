import { fireEvent, screen } from '@testing-library/react-native';
import {
  AppText,
  IconButton,
  InlineAlert,
  MetricCard,
  OfflineBanner,
  SyncStatusIndicator,
  type SyncStatus,
} from '../../src/components';
import { MAX_FONT_SCALE, touchTarget } from '../../src/theme';
import { flatStyle, renderWithProviders } from '../utils/render';

describe('IconButton', () => {
  it('is a labelled 48dp button', async () => {
    const onPress = jest.fn();
    await renderWithProviders(
      <IconButton icon="bell-outline" accessibilityLabel="Open notifications" onPress={onPress} />,
    );
    const button = screen.getByRole('button', { name: 'Open notifications' });
    expect(flatStyle(button).minHeight).toBeGreaterThanOrEqual(touchTarget.min);
    expect(flatStyle(button).minWidth).toBeGreaterThanOrEqual(touchTarget.min);
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalled();
  });
});

describe('SyncStatusIndicator', () => {
  it.each<[SyncStatus, string, string]>([
    ['online', 'Online', 'ऑनलाइन'],
    ['offline', 'Offline', 'ऑफ़लाइन'],
    ['syncPending', 'Waiting to sync', 'सिंक की प्रतीक्षा'],
    ['syncing', 'Syncing…', 'सिंक हो रहा है…'],
    ['syncFailed', 'Sync failed', 'सिंक विफल'],
  ])('%s is shown as text in both languages', async (status, english, hindi) => {
    const { rerender } = await renderWithProviders(<SyncStatusIndicator status={status} />);
    expect(screen.getByText(english)).toBeOnTheScreen();
    await rerender(<></>);
    await renderWithProviders(<SyncStatusIndicator status={status} />, { language: 'hi' });
    expect(screen.getByText(hindi)).toBeOnTheScreen();
  });
});

describe('OfflineBanner', () => {
  it('announces the offline state as an alert', async () => {
    await renderWithProviders(<OfflineBanner visible />);
    expect(screen.getByRole('alert')).toHaveTextContent(/You are offline/);
  });

  it('renders nothing when online', async () => {
    await renderWithProviders(<OfflineBanner visible={false} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('InlineAlert', () => {
  it('is announced as an alert with its message', async () => {
    await renderWithProviders(<InlineAlert message="Cannot reach the server." />);
    expect(screen.getByRole('alert', { name: 'Cannot reach the server.' })).toBeOnTheScreen();
  });
});

describe('MetricCard unavailable label', () => {
  it('uses a custom reason when given', async () => {
    await renderWithProviders(
      <MetricCard
        label="Registered children"
        icon="account-child-outline"
        state={{ status: 'unavailable' }}
        unavailableLabel="Not available for your role"
      />,
    );
    expect(screen.getByText('Not available for your role')).toBeOnTheScreen();
    expect(screen.getByLabelText('Registered children: Not available for your role')).toBeOnTheScreen();
    expect(screen.queryByText('0')).toBeNull();
  });
});

describe('text scaling', () => {
  it('keeps system font scaling on, with the documented cap', async () => {
    await renderWithProviders(<AppText>Scaled text</AppText>);
    const text = screen.getByText('Scaled text');
    expect(text.props.allowFontScaling).not.toBe(false);
    expect(text.props.maxFontSizeMultiplier).toBe(MAX_FONT_SCALE);
    expect(MAX_FONT_SCALE).toBeGreaterThanOrEqual(1.5);
  });
});
