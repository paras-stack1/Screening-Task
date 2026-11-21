import { fireEvent, screen } from '@testing-library/react-native';
import { ActionCard, FourDCategoryCard, MetricCard } from '../../src/components';
import { touchTarget } from '../../src/theme';
import { flatStyle, renderWithProviders } from '../utils/render';

describe('MetricCard', () => {
  it('shows a real value with an accessible summary', async () => {
    await renderWithProviders(
      <MetricCard
        label="Registered children"
        icon="account-child-outline"
        state={{ status: 'ready', value: 1234 }}
      />,
    );
    expect(screen.getByText('1,234')).toBeOnTheScreen();
    expect(screen.getByLabelText('Registered children: 1,234')).toBeOnTheScreen();
  });

  it('shows zero only when the value really is zero', async () => {
    await renderWithProviders(
      <MetricCard
        label="Screened today"
        icon="clipboard-pulse-outline"
        state={{ status: 'ready', value: 0 }}
      />,
    );
    expect(screen.getByText('0')).toBeOnTheScreen();
  });

  it('never presents unavailable data as zero (decision C)', async () => {
    await renderWithProviders(
      <MetricCard label="Pending referrals" icon="hospital-building" state={{ status: 'unavailable' }} />,
    );
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.getByText('—')).toBeOnTheScreen();
    expect(screen.getByText('Not available yet')).toBeOnTheScreen();
    expect(screen.getByLabelText('Pending referrals: not available yet')).toBeOnTheScreen();
  });

  it('distinguishes a load error from unavailable', async () => {
    await renderWithProviders(
      <MetricCard label="Registered children" icon="account-child-outline" state={{ status: 'error' }} />,
    );
    expect(screen.getByText('Could not load')).toBeOnTheScreen();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('announces loading', async () => {
    await renderWithProviders(
      <MetricCard label="Registered children" icon="account-child-outline" state={{ status: 'loading' }} />,
    );
    expect(screen.getByLabelText('Registered children: loading')).toBeOnTheScreen();
  });

  it('works in Hindi', async () => {
    await renderWithProviders(
      <MetricCard label="पंजीकृत बच्चे" icon="account-child-outline" state={{ status: 'unavailable' }} />,
      {
        language: 'hi',
      },
    );
    expect(screen.getByText('अभी उपलब्ध नहीं')).toBeOnTheScreen();
  });
});

describe('ActionCard', () => {
  it('is a pressable button when available', async () => {
    const onPress = jest.fn();
    await renderWithProviders(
      <ActionCard
        title="Register child"
        description="Add a new child"
        icon="account-plus-outline"
        onPress={onPress}
      />,
    );
    const card = screen.getByRole('button', { name: 'Register child' });
    expect(flatStyle(card).minHeight).toBeGreaterThanOrEqual(touchTarget.primary);
    await fireEvent.press(card);
    expect(onPress).toHaveBeenCalled();
  });

  it('is disabled and labelled "Coming soon" without an action (decision D)', async () => {
    await renderWithProviders(
      <ActionCard title="Start screening" description="Guided 4-D screening" icon="stethoscope" />,
    );
    const card = screen.getByRole('button', { name: 'Start screening. Coming soon' });
    expect(card).toBeDisabled();
    expect(screen.getByText('Coming soon')).toBeOnTheScreen();
  });
});

describe('FourDCategoryCard', () => {
  it('shows the category title and description as text', async () => {
    await renderWithProviders(
      <FourDCategoryCard
        category="deficiencies"
        title="Deficiencies"
        description="Nutrition-related conditions"
      />,
    );
    expect(screen.getByText('Deficiencies')).toBeOnTheScreen();
    expect(screen.getByText('Nutrition-related conditions')).toBeOnTheScreen();
  });
});
