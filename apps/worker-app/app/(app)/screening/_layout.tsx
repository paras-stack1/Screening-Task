import { Stack } from 'expo-router';
import { useTranslation } from '../../../src/localization';
import { colors } from '../../../src/theme';

/**
 * Screening section (Step 6): home -> choose child -> eligibility -> session -> category /
 * measurements. Reached from the dashboard and the child profile, not a tab. URLs carry only
 * opaque ids and category codes; every screen re-reads its data from the API.
 */
export default function ScreeningLayout() {
  const { t } = useTranslation();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.textPrimary,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: t('screening.home.title') }} />
      <Stack.Screen name="select-child" options={{ title: t('screening.selectChild.title') }} />
      <Stack.Screen name="start/[childId]" options={{ title: t('screening.eligibility.title') }} />
      <Stack.Screen name="[sessionId]/index" options={{ title: t('screening.session.title') }} />
      <Stack.Screen
        name="[sessionId]/category/[category]"
        options={{ title: t('screening.category.title') }}
      />
      <Stack.Screen name="[sessionId]/measurements" options={{ title: t('screening.measurement.title') }} />
      <Stack.Screen name="[sessionId]/review" options={{ title: t('screening.review.title') }} />
      <Stack.Screen name="[sessionId]/summary" options={{ title: t('screening.summary.title') }} />
      <Stack.Screen name="[sessionId]/amend" options={{ title: t('screening.amend.title') }} />
      <Stack.Screen name="review-queue" options={{ title: t('screening.reviewQueue.title') }} />
      <Stack.Screen name="[sessionId]/result" options={{ title: t('results.title') }} />
      <Stack.Screen name="results" options={{ title: t('results.listTitle') }} />
      <Stack.Screen name="reviews/index" options={{ title: t('reviews.title') }} />
      <Stack.Screen name="reviews/[reviewId]" options={{ title: t('reviews.detailTitle') }} />
      <Stack.Screen name="history/[childId]" options={{ title: t('screening.history.title') }} />
    </Stack>
  );
}
