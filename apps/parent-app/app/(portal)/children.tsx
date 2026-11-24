import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useChildren, useSelectedChild } from '../../src/children';
import { Avatar, Loading, Screen, T } from '../../src/components/ui';
import { useI18n } from '../../src/i18n';
import { colors, radius, spacing, touch } from '../../src/theme';

/** Child selection (brief screen 9): only the children shared with this parent. */
export default function ChildrenScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const children = useChildren();
  const { child: selected, select } = useSelectedChild(children.data);
  return (
    <Screen title={t('children.title')} back testID="children-screen">
      {children.isPending ? <Loading label={t('common.loading')} /> : null}
      {children.data?.map((c) => {
        const active = c.childId === selected?.childId;
        return (
          <Pressable
            key={c.childId}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={c.fullName}
            onPress={() => {
              select(c.childId);
              router.back();
            }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
              minHeight: touch + 24,
              padding: spacing.md,
              borderRadius: radius.lg,
              borderWidth: 2,
              borderColor: active ? colors.primary : colors.border,
              backgroundColor: active ? colors.primarySurface : colors.surface,
            }}
            testID={`select-child-${c.childId}`}
          >
            <Avatar name={c.fullName} />
            <View style={{ flex: 1 }}>
              <T variant="large">{c.fullName}</T>
              <T variant="small">{t('home.age', { years: c.ageYears, months: c.ageMonths })}</T>
            </View>
            {active ? <MaterialCommunityIcons name="check-circle" size={28} color={colors.primary} /> : null}
          </Pressable>
        );
      })}
    </Screen>
  );
}
