/** Strong confirmation tokens for destructive trash actions. */

export function confirmsPermanentDelete(input: string | null | undefined): boolean {
  return (input ?? "").trim() === "DELETE";
}

export function confirmsEmptyTrash(input: string | null | undefined): boolean {
  return (input ?? "").trim() === "EMPTY";
}
