import { StyleSheet, View } from 'react-native';
import { fourDColors, radius, spacing, type FourDCategory } from '../../theme';
import { AppCard } from '../common/AppCard';
import { AppIcon, type IconName } from '../common/AppIcon';
import { AppText } from '../common/AppText';

const categoryIcons: Record<FourDCategory, IconName> = {
  defectsAtBirth: 'baby-face-outline',
  deficiencies: 'food-apple-outline',
  diseases: 'virus-outline',
  developmentalDelays: 'human-child',
};

interface FourDCategoryCardProps {
  category: FourDCategory;
  /** Translated, expert-reviewed label (docs/frontend/localization.md). */
  title: string;
  description: string;
  testID?: string;
}

/**
 * Informational RBSK 4-D category card. Identified by icon + title + colour, never colour alone.
 * Shows no screening results.
 */
export function FourDCategoryCard({ category, title, description, testID }: FourDCategoryCardProps) {
  const tone = fourDColors[category];

  return (
    <AppCard accentColor={tone.accent} style={styles.card} accessible testID={testID}>
      <View style={[styles.iconBox, { backgroundColor: tone.surface }]}>
        <AppIcon name={categoryIcons[category]} color={tone.accent} />
      </View>
      <AppText variant="bodyStrong" style={{ color: tone.accent }}>
        {title}
      </AppText>
      <AppText variant="bodySmall" color="textSecondary">
        {description}
      </AppText>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, minWidth: 150, gap: spacing.xs },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
