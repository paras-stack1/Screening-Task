import { fireEvent, screen } from '@testing-library/react-native';
import { AppButton, PrimaryButton, SecondaryButton } from '../../src/components';
import { touchTarget } from '../../src/theme';
import { flatStyle, renderWithProviders } from '../utils/render';

describe('AppButton', () => {
  it('is an accessible button that calls onPress', async () => {
    const onPress = jest.fn();
    await renderWithProviders(<PrimaryButton label="Sign in" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not respond when disabled', async () => {
    const onPress = jest.fn();
    await renderWithProviders(<AppButton label="Sign in" onPress={onPress} disabled />);
    const button = screen.getByRole('button', { name: 'Sign in' });
    expect(button).toBeDisabled();
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('blocks repeated presses while loading and reports busy', async () => {
    const onPress = jest.fn();
    await renderWithProviders(<AppButton label="Sign in" onPress={onPress} loading />);
    const button = screen.getByRole('button', { name: 'Sign in' });
    expect(button).toBeBusy();
    await fireEvent.press(button);
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('meets the primary touch-target size', async () => {
    await renderWithProviders(<SecondaryButton label="Retry" onPress={() => undefined} />);
    const style = flatStyle(screen.getByRole('button', { name: 'Retry' }));
    expect(style.minHeight).toBeGreaterThanOrEqual(touchTarget.min);
  });

  it('never truncates a long Hindi label', async () => {
    const long = 'स्वास्थ्य जाँच शुरू करने के लिए यहाँ दबाएँ और आगे के निर्देशों का पालन करें';
    await renderWithProviders(<AppButton label={long} onPress={() => undefined} />);
    expect(screen.getByText(long).props.numberOfLines).toBeUndefined();
  });
});
