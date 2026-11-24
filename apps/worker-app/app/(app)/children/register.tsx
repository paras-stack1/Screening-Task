import { useLocalSearchParams } from 'expo-router';
import { ScreenContainer } from '../../../src/components';
import {
  REGISTRATION_MAX_WIDTH,
  RegisterChildForm,
} from '../../../src/features/children/components/RegisterChildForm';

/** Register a child. `?siblingOf=<childId>` offers that child's guardians for reuse. */
export default function RegisterChildScreen() {
  const { siblingOf } = useLocalSearchParams<{ siblingOf?: string }>();
  return (
    <ScreenContainer
      edges={['left', 'right']}
      keyboardAware
      maxContentWidth={REGISTRATION_MAX_WIDTH}
      testID="register-screen"
    >
      <RegisterChildForm siblingOf={typeof siblingOf === 'string' ? siblingOf : undefined} />
    </ScreenContainer>
  );
}
