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
  PrimaryButton,
  ScreenContainer,
} from '../../../src/components';
import { useChildList, useChildPermissions } from '../../../src/features/children/hooks';
import { areaLabel, birthText } from '../../../src/features/children/labels';
import { childRoutes } from '../../../src/features/children/routes';
import { useTranslation } from '../../../src/localization';
import { apiErrorMessageKey } from '../../../src/services/api/errorMessages';
import { colors, radius, spacing, touchTarget } from '../../../src/theme';

const SEARCH_DELAY_MS = 400;

/**
 * Children in the worker's areas (the API limits the list; the total is in-scope only). Search
 * needs 2+ characters. 20 per page with "load more" so long lists never freeze the phone.
 */
export default function ChildrenListScreen() {
  const { t, language } = useTranslation();
  const router = useRouter();
  const permissions = useChildPermissions();
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setSearch(input), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [input]);

  // Roles without child.read (e.g. administrators, decision D3) never request child records.
  const list = useChildList(search, permissions.canRead);
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;

  return (
    <ScreenContainer edges={['left', 'right']} keyboardAware testID="children-screen">
      {permissions.canCreate ? (
        <PrimaryButton
          icon="account-plus-outline"
          label={t('children.list.register')}
          onPress={() => router.push(childRoutes.register())}
          testID="children-register"
        />
      ) : null}
      <AppInput
        label={t('children.list.searchLabel')}
        hint={t('children.list.searchHint')}
        value={input}
        onChangeText={setInput}
        autoCorrect={false}
        autoComplete="off"
        returnKeyType="search"
        testID="children-search"
      />

      {permissions.loaded && !permissions.canRead ? (
        <EmptyState
          icon="lock-outline"
          title={t('dashboard.metrics.notForRole')}
          testID="children-not-for-role"
        />
      ) : !permissions.loaded || list.isPending ? (
        <LoadingIndicator label={t('common.loading')} />
      ) : list.isError && items.length === 0 ? (
        <ErrorState message={t(apiErrorMessageKey(list.error))} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="account-child-outline"
          title={search.trim().length >= 2 ? t('children.list.noMatches') : t('children.list.empty')}
          testID="children-empty"
        />
      ) : (
        <View style={styles.list}>
          <AppText variant="caption" color="textSecondary" accessibilityLiveRegion="polite">
            {t('children.list.count', { shown: items.length, total })}
          </AppText>
          {items.map((child) => (
            <Pressable
              key={child.id}
              accessibilityRole="button"
              accessibilityLabel={`${child.fullName}, ${birthText(t, child)}, ${areaLabel(language, child)}`}
              onPress={() => router.push(childRoutes.profile(child.id))}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              testID={`child-row-${child.id}`}
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
              testID="children-load-more"
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
