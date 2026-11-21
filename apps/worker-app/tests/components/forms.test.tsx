import { fireEvent, screen } from '@testing-library/react-native';
import { AppInput, LanguageSelector, PasswordInput } from '../../src/components';
import { createMemoryStore, storageKeys } from '../../src/services/storage/secureStorage';
import { touchTarget } from '../../src/theme';
import { flatStyle, renderWithProviders } from '../utils/render';

describe('AppInput', () => {
  it('has a visible label used as its accessible name', async () => {
    const onChangeText = jest.fn();
    await renderWithProviders(<AppInput label="Employee ID" value="" onChangeText={onChangeText} />);
    expect(screen.getByText('Employee ID')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Employee ID'), 'EMP-1');
    expect(onChangeText).toHaveBeenCalledWith('EMP-1');
  });

  it('announces a validation error as an alert', async () => {
    await renderWithProviders(<AppInput label="Employee ID" value="" error="Enter your employee ID" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your employee ID');
  });

  it('shows the hint only when there is no error', async () => {
    const { rerender } = await renderWithProviders(
      <AppInput label="ID" value="" hint="As on your ID card" />,
    );
    expect(screen.getByText('As on your ID card')).toBeOnTheScreen();
    await rerender(<AppInput label="ID" value="" hint="As on your ID card" error="Required" />);
    expect(screen.queryByText('As on your ID card')).toBeNull();
  });
});

describe('PasswordInput', () => {
  it('hides the password by default and disables autocorrect', async () => {
    await renderWithProviders(<PasswordInput label="Password" value="secret" />);
    const input = screen.getByLabelText('Password');
    expect(input.props.secureTextEntry).toBe(true);
    expect(input.props.autoCorrect).toBe(false);
    expect(input.props.autoCapitalize).toBe('none');
  });

  it('toggles visibility with an accessible, full-size button', async () => {
    await renderWithProviders(<PasswordInput label="Password" value="secret" />);
    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(flatStyle(toggle).minHeight).toBeGreaterThanOrEqual(touchTarget.min);
    await fireEvent.press(toggle);
    expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(false);
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeOnTheScreen();
  });

  it('labels the toggle in Hindi', async () => {
    await renderWithProviders(<PasswordInput label="पासवर्ड" value="" />, { language: 'hi' });
    expect(screen.getByRole('button', { name: 'पासवर्ड दिखाएँ' })).toBeOnTheScreen();
  });
});

describe('LanguageSelector', () => {
  it('shows both languages as radio buttons in their own script', async () => {
    await renderWithProviders(<LanguageSelector />, { language: 'en' });
    expect(screen.getByRole('radio', { name: 'English' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'हिंदी' })).not.toBeChecked();
  });

  it('switches the whole UI language and saves the choice', async () => {
    const store = createMemoryStore();
    await renderWithProviders(<LanguageSelector />, { language: 'en', store });
    expect(screen.getByLabelText('Language')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: 'हिंदी' }));
    expect(screen.getByLabelText('भाषा')).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'हिंदी' })).toBeChecked();
    expect(await store.getItem(storageKeys.language)).toBe('hi');
  });

  it('options meet the touch-target size', async () => {
    await renderWithProviders(<LanguageSelector />);
    for (const radio of screen.getAllByRole('radio')) {
      expect(flatStyle(radio).minHeight).toBeGreaterThanOrEqual(touchTarget.min);
    }
  });
});
