import { useLocalSearchParams } from 'expo-router';
import { ScreenContainer } from '../../../src/components';
import { RegisterChildForm } from '../../../src/features/children/components/RegisterChildForm';

/** Register a child. `?siblingOf=<childId>` offers that child's guardians for reuse. */
export default function RegisterChildScreen() {
  const { siblingOf } = useLocalSearchParams<{ siblingOf?: string }>();
  return (
    <ScreenContainer edges={['left', 'right']} keyboardAware testID="register-screen">
      <RegisterChildForm siblingOf={typeof siblingOf === 'string' ? siblingOf : undefined} />
    </ScreenContainer>
  );
}
