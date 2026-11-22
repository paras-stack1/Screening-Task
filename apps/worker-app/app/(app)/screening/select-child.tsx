import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  AppButton,
  AppIcon,
  AppInput,
  AppText,
  EmptyState,
  ErrorState,
  LoadingIndicator,
  ScreenContainer,
} from '../../../src/components';
import { useChildList, useChildPermissions } from '../../../src/features/children/hooks';
import { areaLabel, birthText } from '../../../src/features/children/labels';
import { screeningRoutes } from '../../../src/features/screening/routes';
import { useTranslation } from '../../../src/localization';
import { apiErrorMessageKey } from '../../../src/services/api/errorMessages';
import { colors, radius, spacing, touchTarget } from '../../../src/theme';

const SEARCH_DELAY_MS = 400;

/**
 * Choose a registered child to screen. The API limits the list to the worker's areas; choosing a
 * child only opens the eligibility check - nothing is created yet.
 */
export default function SelectChildScreen() {
  const { t, language } = useTranslation();
  const router = useRouter();
  const permissions = useChildPermissions();
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setSearch(input), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [input]);

  const list = useChildList(search, permissions.canRead);
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <ScreenContainer edges={['left', 'right']} keyboardAware testID="screening-select-child">
      <AppText color="textSecondary">{t('screening.selectChild.intro')}</AppText>
      <AppInput
        label={t('children.list.searchLabel')}
        hint={t('children.list.searchHint')}
        value={input}
        onChangeText={setInput}
        autoCorrect={false}
        autoComplete="off"
        returnKeyType="search"
        testID="screening-child-search"
      />
      {permissions.loaded && !permissions.canRead ? (
        <EmptyState icon="lock-outline" title={t('dashboard.metrics.notForRole')} />
      ) : !permissions.loaded || list.isPending ? (
        <LoadingIndicator label={t('common.loading')} />
      ) : list.isError && items.length === 0 ? (
        <ErrorState message={t(apiErrorMessageKey(list.error))} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="account-child-outline"
          title={search.trim().length >= 2 ? t('children.list.noMatches') : t('children.list.empty')}
          testID="screening-children-empty"
        />
      ) : (
        <View style={styles.list}>
          {items.map((child) => (
            <Pressable
              key={child.id}
              accessibilityRole="button"
              accessibilityLabel={`${child.fullName}, ${birthText(t, child)}, ${areaLabel(language, child)}`}
              onPress={() => router.push(screeningRoutes.start(child.id))}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              testID={`screening-child-${child.id}`}
            >
              <View style={styles.rowText}>
                <AppText variant="bodyStrong">{child.fullName}</AppText>
                <AppText variant="bodySmall">{birthText(t, child)}</AppText>
                <AppText variant="caption" color="textSecondary">
                  {areaLabel(language, child)}
                </AppText>
              </View>
              <AppIcon name="chevron-right" color={colors.textSecondary} />
            </Pressable>
          ))}
          {list.hasNextPage ? (
            <AppButton
              variant="secondary"
              label={t('children.list.loadMore')}
              onPress={() => void list.fetchNextPage()}
              loading={list.isFetchingNextPage}
            />
          ) : null}
        </View>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touchTarget.primary,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { backgroundColor: colors.primarySurface },
  rowText: { flex: 1, gap: spacing.xxs },
});
