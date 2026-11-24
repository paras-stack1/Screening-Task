import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';
import { Button, Card, Screen, T } from '../src/components/ui';
import { useI18n } from '../src/i18n';
import { colors } from '../src/theme';

/** Activation success (brief screen 5). The parent then signs in themselves. */
export default function ActivatedScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { phone } = useLocalSearchParams<{ phone?: string }>();
  return (
    <Screen title={t('app.name')} testID="activated-screen">
      <Card>
        <View style={{ alignItems: 'center' }}>
          <MaterialCommunityIcons name="check-circle" size={72} color={colors.success} />
        </View>
        <T variant="title">{t('activated.title')}</T>
        <T>{t('activated.body', { phone: phone ?? '' })}</T>
      </Card>
      <Button
        label={t('activated.signIn')}
        onPress={() => router.replace('/login')}
        testID="activated-sign-in"
      />
    </Screen>
  );
}
