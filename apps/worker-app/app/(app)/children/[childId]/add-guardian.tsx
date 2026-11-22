import { useLocalSearchParams } from 'expo-router';
import { ScreenContainer } from '../../../../src/components';
import { AddGuardianForm } from '../../../../src/features/children/components/AddGuardianForm';

export default function AddGuardianScreen() {
  const { childId } = useLocalSearchParams<{ childId: string }>();
  return (
    <ScreenContainer edges={['left', 'right']} keyboardAware testID="add-guardian-screen">
      <AddGuardianForm childId={childId ?? ''} />
    </ScreenContainer>
  );
}
