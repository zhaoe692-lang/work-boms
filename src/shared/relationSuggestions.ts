/** Keys and filters for inferred (wikilink) relation suggestions. */

export function suggestionKey(from: string, to: string): string {
  return `${from}->${to}`;
}

export function isInferredSuggestion(relation: {
  inferred?: boolean;
}): boolean {
  return relation.inferred === true;
}

export function filterDismissedSuggestions<
  T extends { from: string; to: string; inferred?: boolean },
>(relations: T[], dismissedKeys: Iterable<string>): T[] {
  const dismissed = new Set(dismissedKeys);
  return relations.filter(
    (relation) =>
      !isInferredSuggestion(relation) ||
      !dismissed.has(suggestionKey(relation.from, relation.to)),
  );
}
